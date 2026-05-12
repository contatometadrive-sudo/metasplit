const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, transaction } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVER_URL = 'https://metasplit.online';

// Status considerados "venda confirmada" (entram em faturamento e contagem).
// Qualquer outro status é ignorado para fins de métricas.
const APPROVED_STATUSES = ['approved', 'paid'];
const APPROVED_SQL = APPROVED_STATUSES.map(s => `'${s}'`).join(',');

function sanitizeDomainUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}

// Filtro básico de bot/crawler para o endpoint de tracking.
// Bloqueia ausência de UA e padrões conhecidos de robôs.
const BOT_UA_REGEX = /bot|crawl|spider|slurp|fetch\b|monitor|scan|preview|wget|curl|python-requests|axios|node-fetch|java\/|httpclient|okhttp|go-http-client|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|googlebot|bingbot|yandex|baidu|duckduck|semrush|ahrefs|mj12|dotbot|petal|applebot|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|gtmetrix|pingdom|uptime/i;

function isLikelyBot(ua) {
  if (!ua) return true;
  const trimmed = String(ua).trim();
  if (trimmed.length < 15) return true;
  // Browsers reais sempre começam com "Mozilla/" — bibliotecas/bots normalmente não.
  if (!/mozilla\//i.test(trimmed)) return true;
  if (BOT_UA_REGEX.test(trimmed)) return true;
  return false;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

async function fetchUtmifyOrders(dashboardId, token, startDate, endDate) {
  try {
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end   = endDate   || new Date().toISOString().split('T')[0];
    const params = new URLSearchParams({ dashboard_id: dashboardId, start_date: start, end_date: end, per_page: 500 });
    const res = await fetch(
      `https://api.utmify.com.br/api-credentials/v2/orders?${params}`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) { console.error(`Utmify: ${res.status} ${res.statusText}`); return null; }
    return await res.json();
  } catch (err) {
    console.error('Utmify fetch error:', err.message);
    return null;
  }
}

function calcSrcMetrics(payload, src) {
  let revenue = 0, sales = 0, refunds = 0;
  try {
    const orders = payload?.data?.orders ?? payload?.orders ?? payload?.data ?? [];
    for (const o of orders) {
      const oSrc = o.utm_source ?? o.src ?? o.utms?.utm_source ?? o.params?.src ?? '';
      if (oSrc !== src) continue;
      const val = parseFloat(o.total_value ?? o.value ?? o.amount ?? 0);
      const st  = (o.status ?? '').toLowerCase();
      if (['paid','approved','complete','completed'].includes(st))           { revenue += val; sales++; }
      else if (['refunded','cancelled','canceled','chargeback'].includes(st)) refunds++;
    }
  } catch (e) { console.error('calcSrcMetrics:', e.message); }
  return { revenue, sales, refunds };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

app.post('/api/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const run = transaction(data => {
    for (const [k, v] of Object.entries(data)) upsert.run(k, String(v));
  });
  run(req.body);
  res.json({ success: true });
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

app.get('/api/campaigns', (req, res) => {
  // Subqueries em vez de LEFT JOIN + GROUP BY — evita o produto cartesiano
  // entre clicks × destinations × sales que multiplicava SUM(amount) e contagens.
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM clicks       WHERE campaign_id = c.id)                                                AS total_clicks,
      (SELECT COUNT(*) FROM destinations WHERE campaign_id = c.id)                                                AS destination_count,
      (SELECT COALESCE(SUM(amount),0) FROM sales WHERE campaign_id = c.id AND status IN (${APPROVED_SQL}))         AS total_revenue,
      (SELECT COUNT(*)                FROM sales WHERE campaign_id = c.id AND status IN (${APPROVED_SQL}))         AS total_sales
    FROM campaigns c
    ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/campaigns', (req, res) => {
  const { name, utmify_dashboard_id, utmify_dashboard_name, destinations } = req.body;
  const domain_url = sanitizeDomainUrl(req.body.domain_url);
  const product_filter = (req.body.product_filter || '').trim();

  if (!name || !domain_url || !Array.isArray(destinations) || !destinations.length)
    return res.status(400).json({ error: 'Campos obrigatórios: name, domain_url, destinations.' });

  if (destinations.length > 4)
    return res.status(400).json({ error: 'Máximo de 4 destinos permitidos.' });

  const total = destinations.reduce((s, d) => s + Number(d.weight || 0), 0);
  if (Math.abs(total - 100) > 0.5)
    return res.status(400).json({ error: `Total do tráfego deve ser 100% (atual: ${total.toFixed(1)}%).` });

  const insC = db.prepare(`
    INSERT INTO campaigns (name, utmify_dashboard_id, utmify_dashboard_name, domain_url, product_filter)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insD = db.prepare(`
    INSERT INTO destinations (campaign_id, url, src, weight, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const create = transaction(() => {
    const { lastInsertRowid: cid } = insC.run(
      name, utmify_dashboard_id || '', utmify_dashboard_name || '', domain_url, product_filter
    );
    destinations.forEach((d, i) => insD.run(cid, d.url, d.src, Number(d.weight), i));
    return cid;
  });

  try {
    const id = create();
    res.json({ id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/campaigns/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const destinations = db.prepare(
    'SELECT * FROM destinations WHERE campaign_id = ? ORDER BY sort_order'
  ).all(req.params.id);
  res.json({ ...c, destinations });
});

app.put('/api/campaigns/:id', (req, res) => {
  const { name, destinations } = req.body;
  const domain_url = sanitizeDomainUrl(req.body.domain_url);
  const product_filter = (req.body.product_filter || '').trim();

  if (!name || !domain_url || !Array.isArray(destinations) || !destinations.length)
    return res.status(400).json({ error: 'Campos obrigatórios: name, domain_url, destinations.' });

  if (destinations.length > 4)
    return res.status(400).json({ error: 'Máximo de 4 destinos permitidos.' });

  const total = destinations.reduce((s, d) => s + Number(d.weight || 0), 0);
  if (Math.abs(total - 100) > 0.5)
    return res.status(400).json({ error: `Total do tráfego deve ser 100% (atual: ${total.toFixed(1)}%).` });

  const c = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const updC  = db.prepare('UPDATE campaigns SET name = ?, domain_url = ?, product_filter = ? WHERE id = ?');
  const nullC = db.prepare('UPDATE clicks SET destination_id = NULL WHERE campaign_id = ?');
  const delD  = db.prepare('DELETE FROM destinations WHERE campaign_id = ?');
  const insD  = db.prepare('INSERT INTO destinations (campaign_id, url, src, weight, sort_order) VALUES (?, ?, ?, ?, ?)');

  const update = transaction(() => {
    updC.run(name, domain_url, product_filter, req.params.id);
    nullC.run(req.params.id);
    delD.run(req.params.id);
    destinations.forEach((d, i) => insD.run(req.params.id, d.url, d.src, Number(d.weight), i));
  });

  try {
    update();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/campaigns/:id', (req, res) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Reset campaign data ──────────────────────────────────────────────────────

app.delete('/api/campaigns/:id/reset', (req, res) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const reset = transaction(() => {
    db.prepare('DELETE FROM clicks WHERE campaign_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sales  WHERE campaign_id = ?').run(req.params.id);
  });

  try {
    reset();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Generate redirect ────────────────────────────────────────────────────────

app.get('/api/campaigns/:id/generate', (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const dests = db.prepare(
    'SELECT id, url, src, weight FROM destinations WHERE campaign_id = ? ORDER BY sort_order'
  ).all(req.params.id);

  const serverUrl  = SERVER_URL.replace(/\/+$/, '');
  const destsJson  = JSON.stringify(dests);
  const campaignId = c.id;

  // HTML mínimo — sem CSS, sem recursos externos, sem spinner. Redirect first, track after.
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title> </title></head><body><script>!function(){var D=${destsJson},T='${serverUrl}/api/track/${campaignId}',K='ms_v_${campaignId}',p={};location.search.slice(1).split('&').forEach(function(s){if(!s)return;var i=s.indexOf('=');try{p[decodeURIComponent(i<0?s:s.slice(0,i))]=decodeURIComponent(i<0?'':s.slice(i+1))}catch(e){}});function wrand(D){var t=D.reduce(function(s,d){return s+d.weight},0),r=Math.random()*t;for(var i=0;i<D.length-1;i++){if((r-=D[i].weight)<0)return D[i];}return D[D.length-1];}var c=null;try{var sv=sessionStorage.getItem(K);if(sv){var sid=parseInt(sv,10);for(var j=0;j<D.length;j++){if(D[j].id===sid){c=D[j];break;}}}}catch(e){}if(!c){c=wrand(D);try{sessionStorage.setItem(K,String(c.id));}catch(e){}}var eq=c.src.indexOf('='),pk=eq>=0?c.src.slice(0,eq):'src',pv=eq>=0?c.src.slice(eq+1):c.src,U=c.url;try{var u=new URL(c.url);for(var k in p){if(k!==pk)u.searchParams.set(k,p[k])}u.searchParams.set(pk,pv);U=u.toString()}catch(e){}window.location.replace(U);try{fetch(T,{method:'POST',headers:{'Content-Type':'application/json'},keepalive:!0,body:JSON.stringify({destination_id:c.id,params:p,referrer:document.referrer||''})})}catch(e){}}();<\/script></body></html>`;

  res.setHeader('Content-Disposition', 'attachment; filename="index.html"');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ─── Track ────────────────────────────────────────────────────────────────────

app.post('/api/track/:id', (req, res) => {
  const { destination_id, params, referrer } = req.body;
  const c = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const ua = req.headers['user-agent'] || '';

  // Filtra bots/crawlers — não conta como clique real
  if (isLikelyBot(ua)) {
    return res.json({ success: true, ignored: 'bot' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

  db.prepare(`
    INSERT INTO clicks (campaign_id, destination_id, params, ip, user_agent, referrer)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    destination_id ?? null,
    JSON.stringify(params || {}),
    ip,
    ua,
    referrer || ''
  );

  res.json({ success: true });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

// Brasil é UTC-3 fixo desde 2019 (sem horário de verão).
const BR_TZ_OFFSET_HOURS = -3;

// SQLite armazena CURRENT_TIMESTAMP no formato 'YYYY-MM-DD HH:MM:SS' UTC.
// Convertendo um instante para esse mesmo formato preservamos comparação
// lexicográfica correta em qualquer query.
function utcMsToSqliteFormat(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

// Aceita só "YYYY-MM-DD HH:MM:SS" — qualquer outro valor é rejeitado.
// Como interpolaremos isso direto no SQL, o regex evita injeção.
function safeUtcDateTime(s) {
  if (typeof s !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s : null;
}

// Converte um "período relativo" (today/yesterday/7d/30d) para a janela UTC
// correspondente em horário de Brasília. Retorna null se for "all" / inválido.
function brazilPeriodToUtcRange(period) {
  // "Hoje" no fuso de Brasília = agora deslocado para UTC-3, então pegamos
  // os componentes Y/M/D em UTC (que após o shift representam Brasília).
  const brShifted = new Date(Date.now() + BR_TZ_OFFSET_HOURS * 3600 * 1000);
  const y  = brShifted.getUTCFullYear();
  const m  = brShifted.getUTCMonth();
  const d  = brShifted.getUTCDate();

  let startDay, endDay;
  switch (period) {
    case 'today':     startDay = d;     endDay = d;     break;
    case 'yesterday': startDay = d - 1; endDay = d - 1; break;
    case '7d':        startDay = d - 6; endDay = d;     break;
    case '30d':       startDay = d - 29;endDay = d;     break;
    default: return null;
  }

  // Brasília 00:00 = UTC 03:00 (mesma data calendário). Date.UTC trata
  // overflow de dia/mês/ano automaticamente.
  const offsetH = -BR_TZ_OFFSET_HOURS;
  const startMs = Date.UTC(y, m, startDay,     offsetH, 0, 0);
  const endMs   = Date.UTC(y, m, endDay + 1,   offsetH, 0, 0); // exclusivo
  return { start: utcMsToSqliteFormat(startMs), end: utcMsToSqliteFormat(endMs) };
}

function getPeriodClause(query) {
  // Prioriza start_utc/end_utc enviados pelo frontend (já em UTC, derivados
  // do calendário em horário de Brasília). Cai pra brazilPeriodToUtcRange
  // se vier só `period`.
  let startUtc = safeUtcDateTime(query.start_utc);
  let endUtc   = safeUtcDateTime(query.end_utc);

  if (!startUtc || !endUtc) {
    const range = brazilPeriodToUtcRange(query.period || 'all');
    if (!range) return '';
    startUtc = range.start;
    endUtc   = range.end;
  }

  // Janela half-open: [start, end). Strings já validadas por regex,
  // interpolar é seguro.
  return `AND created_at >= '${startUtc}' AND created_at < '${endUtc}'`;
}

app.get('/api/campaigns/:id/stats', async (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const period = req.query.period || 'all';
  const periodClause = getPeriodClause(req.query);

  const destinations = db.prepare(
    'SELECT * FROM destinations WHERE campaign_id = ? ORDER BY sort_order'
  ).all(req.params.id);

  const totalClicks = db.prepare(
    `SELECT COUNT(*) AS n FROM clicks WHERE campaign_id = ? ${periodClause}`
  ).get(req.params.id).n;

  const byDest = db.prepare(`
    SELECT destination_id, COUNT(*) AS n
    FROM clicks WHERE campaign_id = ? ${periodClause}
    GROUP BY destination_id
  `).all(req.params.id);
  const clicksMap = Object.fromEntries(byDest.map(r => [r.destination_id, r.n]));

  const timeSeries = db.prepare(`
    SELECT DATE(created_at) AS date, destination_id, COUNT(*) AS n
    FROM clicks
    WHERE campaign_id = ? AND created_at >= DATE('now','-30 days')
    GROUP BY date, destination_id
    ORDER BY date
  `).all(req.params.id);

  const hourly = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS n
    FROM clicks
    WHERE campaign_id = ? AND created_at >= DATE('now','-7 days')
    GROUP BY hour ORDER BY hour
  `).all(req.params.id);

  // Utmify integration
  let utmifyRaw = null, utmifyError = null;
  const token = getSetting('utmify_token');
  if (c.utmify_dashboard_id && token) {
    utmifyRaw = await fetchUtmifyOrders(c.utmify_dashboard_id, token, req.query.start_date, req.query.end_date);
    if (!utmifyRaw) utmifyError = 'Falha ao buscar dados da Utmify. Verifique token e Dashboard ID.';
  }

  // Vendas locais (webhook Payt) agrupadas por destination_id
  const localSalesByDest = db.prepare(`
    SELECT destination_id,
      SUM(CASE WHEN status IN (${APPROVED_SQL}) THEN amount ELSE 0 END) AS revenue,
      SUM(CASE WHEN status IN (${APPROVED_SQL}) THEN 1      ELSE 0 END) AS sales,
      SUM(CASE WHEN status = 'refunded'         THEN 1      ELSE 0 END) AS refunds,
      SUM(CASE WHEN status = 'chargeback'       THEN 1      ELSE 0 END) AS chargebacks
    FROM sales
    WHERE campaign_id = ? ${periodClause}
    GROUP BY destination_id
  `).all(req.params.id);
  const localSalesMap = Object.fromEntries(
    localSalesByDest.map(r => [r.destination_id, r])
  );

  // Vendas sem destino identificado (src não casou com nenhuma campanha)
  const orphanSales = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN (${APPROVED_SQL}) THEN amount ELSE 0 END) AS revenue,
      SUM(CASE WHEN status IN (${APPROVED_SQL}) THEN 1      ELSE 0 END) AS total
    FROM sales
    WHERE campaign_id = ? AND destination_id IS NULL ${periodClause}
  `).get(req.params.id);

  const destStats = destinations.map(d => {
    const clicks  = clicksMap[d.id] || 0;
    const pctReal = totalClicks > 0 ? +((clicks / totalClicks) * 100).toFixed(1) : 0;

    // Prioriza dados locais (webhook); fallback para Utmify
    const local = localSalesMap[d.id];
    let revenue, sales, refunds, chargebacks;

    if (local) {
      revenue     = local.revenue     || 0;
      sales       = local.sales       || 0;
      refunds     = local.refunds     || 0;
      chargebacks = local.chargebacks || 0;
    } else if (utmifyRaw) {
      const m = calcSrcMetrics(utmifyRaw, d.src);
      revenue = m.revenue; sales = m.sales; refunds = m.refunds; chargebacks = 0;
    } else {
      revenue = 0; sales = 0; refunds = 0; chargebacks = 0;
    }

    const conv = clicks > 0 ? +((sales / clicks) * 100).toFixed(2) : 0;
    const rpc  = clicks > 0 ? +(revenue / clicks).toFixed(2) : 0;
    return { ...d, clicks, pctReal, revenue, sales, refunds, chargebacks, conversion: conv, revenuePerClick: rpc };
  });

  const totalDestClicks = destStats.reduce((s, d) => s + d.clicks, 0);

  // Resumo de vendas aprovadas por status (todos os destinos desta campanha)
  const salesSummary = db.prepare(`
    SELECT status, COUNT(*) AS count, SUM(amount) AS total
    FROM sales
    WHERE campaign_id = ? AND status IN (${APPROVED_SQL}) ${periodClause}
    GROUP BY status
  `).all(req.params.id);

  res.json({ period,
    campaign: c,
    totalClicks,
    lostClicks: totalClicks - totalDestClicks,
    destinations: destStats,
    timeSeries,
    hourly,
    salesSummary,
    orphanSales: { revenue: orphanSales?.revenue || 0, total: orphanSales?.total || 0 },
    localSalesActive: localSalesByDest.length > 0,
    utmifyConnected: !!utmifyRaw,
    utmifyError
  });
});

// ─── Webhook Payt ─────────────────────────────────────────────────────────────

/*
  Payload Payt (formato V1 — reconstruído a partir da documentação pública e
  integrações conhecidas como Clint/SellFlux). Campos confirmados:

  {
    "id": "TXN-123456",                  // ID da transação
    "event": "sale.approved",            // Evento: sale.approved | sale.refunded |
                                         //   sale.cancelled | sale.chargeback
    "status": "approved",                // approved | paid | refunded |
                                         //   cancelled | chargeback
    "created_at": "2024-01-01 12:00:00",
    "total": 197.00,                     // Valor bruto da venda (R$)
    "currency": "BRL",
    "payment_method": "credit_card",     // credit_card | pix | boleto
    "installments": 1,
    "product": {
      "id": "prod-abc",
      "name": "Nome do Produto"
    },
    "offer": {
      "id": "offer-abc",
      "name": "Nome da Oferta"
    },
    "customer": {
      "name": "João Silva",
      "email": "joao@email.com",
      "phone": "11999999999",
      "document": "123.456.789-00"
    },
    "utm": {                             // Parâmetros UTM capturados no checkout
      "src": "oferta-a",                 // <- campo principal usado pelo MetaSplit
      "utm_source": "facebook",
      "utm_medium": "cpc",
      "utm_campaign": "camp-x",
      "utm_content": "creative-1",
      "utm_term": ""
    }
  }

  NOTA: A Payt também possui formato V1 Flat onde todos os campos ficam na
  raiz do objeto (utm_src, product_name, customer_email…). O parser abaixo
  tenta ambos os formatos automaticamente.
*/

function extractPaytFields(body) {
  // ── src ──────────────────────────────────────────────────────────────────
  // V1 Flat: chaves com pontos literais, ex: body["link.sources.src"]
  // V1 Nested: body.utm.src
  const rawSrc =
    body?.['link.sources.src']  ||  // V1 Flat (campo principal)
    body?.utm?.src              ||  // V1 Nested
    body?.utm?.utm_source       ||
    body?.utm?.utm_content      ||
    body?.utms?.src             ||
    body?.tracking?.src         ||
    body?.src                   ||
    body?.utm_src               ||
    body?.utm_source            ||
    body?.utm_content           ||
    '';
  const src = String(rawSrc).replace(/^[&?\s]+/, '').trim();
  console.log('[Webhook] rawSrc:', JSON.stringify(rawSrc), '→ src:', src);

  // ── status ────────────────────────────────────────────────────────────────
  const rawStatus = (
    body?.status       ||
    body?.event        ||
    body?.sale?.status ||
    ''
  ).toLowerCase();

  const STATUS_MAP = {
    // V1 Flat
    approved: 'approved', paid: 'approved',
    refunded: 'refunded', chargeback: 'chargeback',
    cancelled: 'cancelled', canceled: 'cancelled',
    expired: 'expired',
    // V1 Nested / legado
    aprovada: 'approved', finalizada: 'approved', complete: 'approved',
    'sale.approved': 'approved',
    reembolsada: 'refunded', 'sale.refunded': 'refunded',
    'sale.chargeback': 'chargeback',
    cancelada: 'cancelled', 'sale.cancelled': 'cancelled',
    expirada: 'expired', 'sale.expired': 'expired',
  };
  const status = STATUS_MAP[rawStatus] || rawStatus || 'unknown';

  // ── valor ─────────────────────────────────────────────────────────────────
  // Usa o valor da comissão do produtor (commission.1.amount), que é
  // o que efetivamente entra no caixa — diferente de transaction.total_price,
  // que soma order bumps e inflaria o faturamento real.
  // V1 Flat: campos em centavos (÷100). V1 Nested (legado): body.total em reais.
  let amount;
  if (body?.['commission.1.amount'] != null) {
    amount = parseFloat(body['commission.1.amount']) / 100;
  } else if (body?.['product.price'] != null) {
    amount = parseFloat(body['product.price']) / 100;
  } else {
    amount = parseFloat(
      body?.total       ??
      body?.amount      ??
      body?.value       ??
      body?.total_value ??
      body?.sale?.total ??
      0
    );
  }

  // ── produto ───────────────────────────────────────────────────────────────
  const productName =
    body?.['product.name']  ||  // V1 Flat
    body?.product?.name     ||  // V1 Nested
    body?.offer?.name       ||
    body?.product_name      ||
    body?.item?.name        ||
    '';

  // ── email ─────────────────────────────────────────────────────────────────
  const customerEmail =
    body?.['customer.email']  ||  // V1 Flat (caso exista)
    body?.customer?.email     ||
    body?.customer_email      ||
    body?.email               ||
    '';

  // ── ID externo ────────────────────────────────────────────────────────────
  const externalId = String(
    body?.transaction_id  ||  // V1 Flat
    body?.id              ||  // V1 Nested
    body?.sale?.id        ||
    ''
  );

  // ── data da venda ─────────────────────────────────────────────────────────
  const saleDate =
    body?.created_at       ||
    body?.date             ||
    body?.sale?.created_at ||
    new Date().toISOString();

  // ── evento ────────────────────────────────────────────────────────────────
  const event = body?.event || body?.type || '';

  return { src, status, amount, productName, customerEmail, externalId, saleDate, event };
}

app.post('/webhook/payt', (req, res) => {
  try {
    const body = req.body;
    console.log('[Webhook] === HEADERS ===');
    console.log(JSON.stringify(req.headers, null, 2));
    console.log('[Webhook] === BODY COMPLETO ===');
    console.log(JSON.stringify(body, null, 2));
    console.log('[Webhook] === FIM BODY ===');
    const { src, status, amount, productName, customerEmail, externalId, saleDate, event } =
      extractPaytFields(body);

    // Só registramos vendas confirmadas. Status como cancelled/canceled/
    // expired/refunded/chargeback são ignorados antes de qualquer escrita
    // no banco — nem inserem novas linhas, nem atualizam vendas existentes.
    if (!APPROVED_STATUSES.includes(status)) {
      console.log('[Webhook] descartado por status="%s" (não é approved/paid)', status);
      return res.json({ received: true, action: 'skipped', reason: `status_ignored:${status}` });
    }

    // Localiza destino e campanha pelo src
    let destinationId = null;
    let campaignId    = null;

    if (src) {
      // srcValue: se src vier como "pv3" (sem =), compara direto; se vier como "src=pv3" extrai "pv3"
      const srcValue = src.includes('=') ? src.split('=').slice(1).join('=') : src;
      console.log('[Webhook] buscando dest: src=%s srcValue=%s', src, srcValue);
      const dest = db.prepare(
        "SELECT * FROM destinations WHERE src = ? OR src = ? OR (src LIKE '%=%' AND SUBSTR(src, INSTR(src,'=')+1) = ?)"
      ).get(src, srcValue, srcValue);
      console.log('[Webhook] dest encontrado:', dest ? `id=${dest.id} campaign=${dest.campaign_id}` : 'nenhum');
      if (dest) {
        destinationId = dest.id;
        campaignId    = dest.campaign_id;
      }
    }

    // Filtro de produto por campanha — quando preenchido, só aceita vendas
    // cujo product.name contenha o texto (case-insensitive).
    if (campaignId) {
      const camp = db.prepare('SELECT product_filter FROM campaigns WHERE id = ?').get(campaignId);
      const filter = (camp?.product_filter || '').trim().toLowerCase();
      if (filter && !String(productName).toLowerCase().includes(filter)) {
        console.log('[Webhook] descartado por product_filter: campaign=%s filter="%s" produto="%s"',
          campaignId, filter, productName);
        return res.json({ received: true, action: 'skipped', reason: 'product_filter_mismatch' });
      }
    }

    // Evita duplicação por external_id (idempotência)
    if (externalId) {
      const existing = db.prepare(
        'SELECT id FROM sales WHERE external_id = ? AND external_id != \'\''
      ).get(externalId);
      if (existing) {
        // Atualiza status/valor caso a Payt reenvie o mesmo external_id
        db.prepare('UPDATE sales SET status = ?, amount = ?, event = ? WHERE external_id = ?')
          .run(status, amount, event, externalId);
        return res.json({ received: true, action: 'updated', id: existing.id });
      }
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO sales
        (campaign_id, destination_id, external_id, event, status, amount,
         src, product_name, customer_email, raw_payload, sale_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      destinationId,
      externalId,
      event,
      status,
      amount,
      src,
      productName,
      customerEmail,
      JSON.stringify(body),
      saleDate
    );

    res.json({ received: true, action: 'created', id: lastInsertRowid, campaign_id: campaignId });
  } catch (err) {
    console.error('Webhook Payt error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ⚡ MetaSplit → http://localhost:${PORT}\n`);
});
