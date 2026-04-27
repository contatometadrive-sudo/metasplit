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

// Status considerados "venda confirmada" (entram em faturamento e contagem)
const APPROVED_STATUSES = ['approved', 'paid'];
// Status "aguardando pagamento" (mostrados separados, não somam ao faturamento)
const PENDING_STATUSES  = ['pending', 'waiting_payment', 'waiting'];

const APPROVED_SQL = APPROVED_STATUSES.map(s => `'${s}'`).join(',');
const PENDING_SQL  = PENDING_STATUSES.map(s => `'${s}'`).join(',');

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
  let revenue = 0, sales = 0, refunds = 0, pending = 0, pendingRevenue = 0;
  try {
    const orders = payload?.data?.orders ?? payload?.orders ?? payload?.data ?? [];
    for (const o of orders) {
      const oSrc = o.utm_source ?? o.src ?? o.utms?.utm_source ?? o.params?.src ?? '';
      if (oSrc !== src) continue;
      const val = parseFloat(o.total_value ?? o.value ?? o.amount ?? 0);
      const st  = (o.status ?? '').toLowerCase();
      if (['paid','approved','complete','completed'].includes(st))        { revenue += val; sales++; }
      else if (['refunded','cancelled','canceled','chargeback'].includes(st)) refunds++;
      else if (['pending','waiting','waiting_payment','processing'].includes(st)) { pending++; pendingRevenue += val; }
    }
  } catch (e) { console.error('calcSrcMetrics:', e.message); }
  return { revenue, sales, refunds, pending, pendingRevenue };
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
  const rows = db.prepare(`
    SELECT c.*,
      COUNT(DISTINCT cl.id)                                                                         AS total_clicks,
      COUNT(DISTINCT d.id)                                                                          AS destination_count,
      COALESCE(SUM(CASE WHEN s.status IN (${APPROVED_SQL}) THEN s.amount ELSE 0 END),0)             AS total_revenue,
      COALESCE(SUM(CASE WHEN s.status IN (${APPROVED_SQL}) THEN 1        ELSE 0 END),0)             AS total_sales,
      COALESCE(SUM(CASE WHEN s.status IN (${PENDING_SQL})  THEN 1        ELSE 0 END),0)             AS pending_count,
      COALESCE(SUM(CASE WHEN s.status IN (${PENDING_SQL})  THEN s.amount ELSE 0 END),0)             AS pending_revenue
    FROM campaigns c
    LEFT JOIN clicks       cl ON cl.campaign_id = c.id
    LEFT JOIN destinations d  ON  d.campaign_id = c.id
    LEFT JOIN sales        s  ON  s.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/campaigns', (req, res) => {
  const { name, utmify_dashboard_id, utmify_dashboard_name, destinations } = req.body;
  const domain_url = sanitizeDomainUrl(req.body.domain_url);

  if (!name || !domain_url || !Array.isArray(destinations) || !destinations.length)
    return res.status(400).json({ error: 'Campos obrigatórios: name, domain_url, destinations.' });

  if (destinations.length > 4)
    return res.status(400).json({ error: 'Máximo de 4 destinos permitidos.' });

  const total = destinations.reduce((s, d) => s + Number(d.weight || 0), 0);
  if (Math.abs(total - 100) > 0.5)
    return res.status(400).json({ error: `Total do tráfego deve ser 100% (atual: ${total.toFixed(1)}%).` });

  const insC = db.prepare(`
    INSERT INTO campaigns (name, utmify_dashboard_id, utmify_dashboard_name, domain_url)
    VALUES (?, ?, ?, ?)
  `);
  const insD = db.prepare(`
    INSERT INTO destinations (campaign_id, url, src, weight, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const create = transaction(() => {
    const { lastInsertRowid: cid } = insC.run(
      name, utmify_dashboard_id || '', utmify_dashboard_name || '', domain_url
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

  if (!name || !domain_url || !Array.isArray(destinations) || !destinations.length)
    return res.status(400).json({ error: 'Campos obrigatórios: name, domain_url, destinations.' });

  if (destinations.length > 4)
    return res.status(400).json({ error: 'Máximo de 4 destinos permitidos.' });

  const total = destinations.reduce((s, d) => s + Number(d.weight || 0), 0);
  if (Math.abs(total - 100) > 0.5)
    return res.status(400).json({ error: `Total do tráfego deve ser 100% (atual: ${total.toFixed(1)}%).` });

  const c = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const updC  = db.prepare('UPDATE campaigns SET name = ?, domain_url = ? WHERE id = ?');
  const nullC = db.prepare('UPDATE clicks SET destination_id = NULL WHERE campaign_id = ?');
  const delD  = db.prepare('DELETE FROM destinations WHERE campaign_id = ?');
  const insD  = db.prepare('INSERT INTO destinations (campaign_id, url, src, weight, sort_order) VALUES (?, ?, ?, ?, ?)');

  const update = transaction(() => {
    updC.run(name, domain_url, req.params.id);
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
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title> </title></head><body><script>!function(){var D=${destsJson},T='${serverUrl}/api/track/${campaignId}',p={};location.search.slice(1).split('&').forEach(function(s){if(!s)return;var i=s.indexOf('=');try{p[decodeURIComponent(i<0?s:s.slice(0,i))]=decodeURIComponent(i<0?'':s.slice(i+1))}catch(e){}});function wrand(D){var t=D.reduce(function(s,d){return s+d.weight},0),r=Math.random()*t;for(var i=0;i<D.length-1;i++){if((r-=D[i].weight)<0)return D[i];}return D[D.length-1];}var c=wrand(D);var eq=c.src.indexOf('='),pk=eq>=0?c.src.slice(0,eq):'src',pv=eq>=0?c.src.slice(eq+1):c.src,U=c.url;try{var u=new URL(c.url);for(var k in p){if(k!==pk)u.searchParams.set(k,p[k])}u.searchParams.set(pk,pv);U=u.toString()}catch(e){}window.location.replace(U);try{fetch(T,{method:'POST',headers:{'Content-Type':'application/json'},keepalive:!0,body:JSON.stringify({destination_id:c.id,params:p,referrer:document.referrer||''})})}catch(e){}}();<\/script></body></html>`;

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

function getPeriodClause(period, start, end) {
  if (start && end) return `AND DATE(created_at) BETWEEN '${start}' AND '${end}'`;
  switch (period) {
    case 'today':     return "AND DATE(created_at) = DATE('now','localtime')";
    case 'yesterday': return "AND DATE(created_at) = DATE('now','localtime','-1 day')";
    case '7d':        return "AND created_at >= DATE('now','localtime','-6 days')";
    case '30d':       return "AND created_at >= DATE('now','localtime','-29 days')";
    case 'all':
    default:          return '';
  }
}

app.get('/api/campaigns/:id/stats', async (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });

  const period = req.query.period || 'all';
  const start  = req.query.start  || null;
  const end    = req.query.end    || null;
  const periodClause = getPeriodClause(period, start, end);

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
      SUM(CASE WHEN status = 'chargeback'       THEN 1      ELSE 0 END) AS chargebacks,
      SUM(CASE WHEN status IN (${PENDING_SQL})  THEN 1      ELSE 0 END) AS pending,
      SUM(CASE WHEN status IN (${PENDING_SQL})  THEN amount ELSE 0 END) AS pending_revenue
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
      SUM(CASE WHEN status IN (${APPROVED_SQL}) THEN 1      ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status IN (${PENDING_SQL})  THEN 1      ELSE 0 END) AS pending_count,
      COUNT(*) AS total
    FROM sales
    WHERE campaign_id = ? AND destination_id IS NULL ${periodClause}
  `).get(req.params.id);

  const destStats = destinations.map(d => {
    const clicks  = clicksMap[d.id] || 0;
    const pctReal = totalClicks > 0 ? +((clicks / totalClicks) * 100).toFixed(1) : 0;

    // Prioriza dados locais (webhook); fallback para Utmify
    const local = localSalesMap[d.id];
    let revenue, sales, refunds, chargebacks, pending, pendingRevenue;

    if (local) {
      revenue        = local.revenue         || 0;
      sales          = local.sales           || 0;
      refunds        = local.refunds         || 0;
      chargebacks    = local.chargebacks     || 0;
      pending        = local.pending         || 0;
      pendingRevenue = local.pending_revenue || 0;
    } else if (utmifyRaw) {
      const m = calcSrcMetrics(utmifyRaw, d.src);
      revenue = m.revenue; sales = m.sales; refunds = m.refunds;
      chargebacks = 0; pending = m.pending; pendingRevenue = m.pendingRevenue || 0;
    } else {
      revenue = 0; sales = 0; refunds = 0; chargebacks = 0; pending = 0; pendingRevenue = 0;
    }

    const conv = clicks > 0 ? +((sales / clicks) * 100).toFixed(2) : 0;
    const rpc  = clicks > 0 ? +(revenue / clicks).toFixed(2) : 0;
    return { ...d, clicks, pctReal, revenue, sales, refunds, chargebacks, pending, pendingRevenue, conversion: conv, revenuePerClick: rpc };
  });

  const totalDestClicks = destStats.reduce((s, d) => s + d.clicks, 0);

  // Resumo de vendas por status (todos os destinos desta campanha)
  const salesSummary = db.prepare(`
    SELECT status, COUNT(*) AS count, SUM(amount) AS total
    FROM sales WHERE campaign_id = ? ${periodClause}
    GROUP BY status
  `).all(req.params.id);

  // Totais de "Aguardando pagamento" da campanha inteira (incluindo órfãs)
  const pendingTotals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
    FROM sales
    WHERE campaign_id = ? AND status IN (${PENDING_SQL}) ${periodClause}
  `).get(req.params.id);

  res.json({ period,
    campaign: c,
    totalClicks,
    lostClicks: totalClicks - totalDestClicks,
    destinations: destStats,
    timeSeries,
    hourly,
    salesSummary,
    pending: { count: pendingTotals?.count || 0, total: pendingTotals?.total || 0 },
    orphanSales: {
      revenue: orphanSales?.revenue || 0,
      total: orphanSales?.total || 0,
      approvedCount: orphanSales?.approved_count || 0,
      pendingCount: orphanSales?.pending_count || 0
    },
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
                                         //   sale.cancelled | sale.chargeback |
                                         //   sale.pending | subscription.activated
    "status": "approved",                // approved | refunded | cancelled |
                                         //   chargeback | pending | waiting
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
    waiting_payment: 'pending', waiting: 'pending',
    refunded: 'refunded', chargeback: 'chargeback',
    cancelled: 'cancelled',
    // V1 Nested / legado
    aprovada: 'approved', finalizada: 'approved', complete: 'approved',
    'sale.approved': 'approved',
    reembolsada: 'refunded', 'sale.refunded': 'refunded',
    'sale.chargeback': 'chargeback',
    cancelada: 'cancelled', 'sale.cancelled': 'cancelled',
    'aguardando pagamento': 'pending', 'sale.pending': 'pending',
  };
  const status = STATUS_MAP[rawStatus] || rawStatus || 'unknown';

  // ── valor ─────────────────────────────────────────────────────────────────
  // V1 Flat: "transaction.total_price" em centavos
  // V1 Nested: body.total em reais
  let amount;
  if (body?.['transaction.total_price'] != null) {
    amount = parseFloat(body['transaction.total_price']) / 100;
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

    // Evita duplicação por external_id (idempotência)
    if (externalId) {
      const existing = db.prepare(
        'SELECT id FROM sales WHERE external_id = ? AND external_id != \'\''
      ).get(externalId);
      if (existing) {
        // Atualiza status se a venda já existe (ex: pending → approved)
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
