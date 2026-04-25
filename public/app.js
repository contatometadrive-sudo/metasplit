// ─── API ─────────────────────────────────────────────────────────────────────

const api = {
  get:    url       => fetch(url).then(r => r.json()),
  post:   (url, d) => fetch(url, { method:'POST',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json()),
  put:    (url, d) => fetch(url, { method:'PUT',   headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json()),
  del:    url       => fetch(url, { method:'DELETE' }).then(r => r.json()),
};

// ─── Charts registry ─────────────────────────────────────────────────────────

let _charts = {};
function destroyCharts() {
  Object.values(_charts).forEach(c => c.destroy());
  _charts = {};
}

// ─── Router ───────────────────────────────────────────────────────────────────

function navigate(path) { window.location.hash = '#' + path; }

function handleRoute() {
  destroyCharts();
  const hash = window.location.hash.slice(1) || '/';

  document.querySelectorAll('.nav-link').forEach(el => {
    const r = el.dataset.route;
    el.classList.toggle('active', r === '/' ? hash === '/' || hash === '' : hash.startsWith(r));
  });

  const app = document.getElementById('app');
  if (hash === '/' || hash === '') return viewCampaignList(app);
  if (hash === '/create')           return viewCreate(app);
  if (hash === '/settings')         return viewSettings(app);
  if (hash === '/webhook-info')     return viewWebhookInfo(app);
  if (hash.startsWith('/campaign/')) {
    const parts = hash.split('/');
    if (parts[3] === 'edit') return viewEdit(app, parts[2]);
    return viewDashboard(app, parts[2]);
  }
  app.innerHTML = `<div class="empty-state"><p>Página não encontrada.</p><a href="#/" class="btn btn-primary">Voltar</a></div>`;
}

window.addEventListener('hashchange', handleRoute);
document.addEventListener('DOMContentLoaded', handleRoute);

// ─── Campaign List ────────────────────────────────────────────────────────────

async function viewCampaignList(app) {
  app.innerHTML = spinner();
  try {
    const campaigns = await api.get('/api/campaigns');
    if (!campaigns.length) {
      app.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <h2>Nenhuma campanha ainda</h2>
          <p>Crie seu primeiro split test e comece a otimizar</p>
          <a href="#/create" class="btn btn-primary">Criar Campanha</a>
        </div>`;
      return;
    }

    app.innerHTML = `
      <div class="page-header">
        <h1>Campanhas</h1>
        <a href="#/create" class="btn btn-primary">+ Nova Campanha</a>
      </div>
      <div class="campaign-grid">
        ${campaigns.map(c => campaignCard(c)).join('')}
      </div>`;
  } catch (e) {
    app.innerHTML = errorBlock('Erro ao carregar campanhas: ' + e.message);
  }
}

function campaignCard(c) {
  return `
    <div class="campaign-card" onclick="navigate('/campaign/${c.id}')">
      <div class="cc-header">
        <div class="cc-title">${esc(c.name)}</div>
        <div class="cc-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" title="Baixar redirect" onclick="downloadRedirect(${c.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="icon-btn" title="Editar" onclick="navigate('/campaign/${c.id}/edit')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" title="Deletar" onclick="confirmDelete(${c.id}, '${esc(c.name)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div class="cc-url">${esc(c.domain_url)}</div>
      <div class="cc-meta">
        <span>${c.destination_count} destino${c.destination_count !== 1 ? 's' : ''}</span>
        <span>${fmtDate(c.created_at)}</span>
      </div>
      <div class="cc-stats">
        <div class="cc-stat">
          <span class="cc-stat-val">${(c.total_clicks || 0).toLocaleString('pt-BR')}</span>
          <span class="cc-stat-lbl">Cliques</span>
        </div>
      </div>
    </div>`;
}

// ─── Create Campaign ──────────────────────────────────────────────────────────

let _destId = 0;

function viewCreate(app) {
  _destId = 0;
  app.innerHTML = `
    <div class="page-header">
      <h1>Nova Campanha</h1>
    </div>
    <form id="create-form" class="form-card" onsubmit="submitCreate(event)">

      <fieldset class="fs">
        <legend>Informações Gerais</legend>
        <div class="fg">
          <label>Nome da Campanha *</label>
          <input name="name" required class="fi" placeholder="Ex: Produto X — Split Teste">
        </div>
        <div class="fg">
          <label>URL do Domínio Principal *</label>
          <input name="domain_url" type="url" required class="fi" placeholder="https://seudominio.com">
          <small>Onde o redirect gerado ficará hospedado</small>
        </div>
      </fieldset>

      <fieldset class="fs">
        <div class="fs-head">
          <legend>Destinos</legend>
          <button type="button" id="add-dest-btn" class="btn btn-ghost btn-sm" onclick="addDest()">+ Destino</button>
        </div>
        <div id="dests"></div>
        <div class="weight-total">Total: <span id="wtotal" class="wval">0%</span></div>
      </fieldset>

      <div class="form-actions">
        <a href="#/" class="btn btn-ghost">Cancelar</a>
        <button type="submit" class="btn btn-primary">Criar Campanha</button>
      </div>
    </form>`;

  addDest(); addDest();
}

function addDest() {
  const container = document.getElementById('dests');
  const count = container.querySelectorAll('.dest-block').length;
  if (count >= 4) { toast('Máximo de 4 destinos.', 'error'); return; }

  const id = _destId++;
  const defaultW = [50, 50, 33, 25];
  const w = defaultW[count] ?? 25;

  const el = document.createElement('div');
  el.className = 'dest-block';
  el.dataset.did = id;
  el.innerHTML = `
    <div class="db-head">
      <span class="db-label">Destino ${count + 1}</span>
      <button type="button" class="btn-rm" onclick="removeDest(${id})">✕</button>
    </div>
    <div class="frow frow-dests">
      <div class="fg fg-url">
        <label>URL *</label>
        <input type="url" name="du_${id}" required class="fi" placeholder="https://oferta.com/pagina">
      </div>
      <div class="fg fg-src">
        <label>Parâmetro *</label>
        <input type="text" name="ds_${id}" required class="fi" placeholder="ex: src=pv3">
      </div>
      <div class="fg fg-w">
        <label>% Tráfego *</label>
        <input type="number" name="dw_${id}" required min="0.1" max="100" step="0.1" value="${w}" class="fi" oninput="updateWTotal()">
      </div>
    </div>`;
  container.appendChild(el);
  reindexDests();
  updateWTotal();
  updateAddBtn();
}

function removeDest(id) {
  const el = document.querySelector(`.dest-block[data-did="${id}"]`);
  if (el) { el.remove(); reindexDests(); updateWTotal(); updateAddBtn(); }
}

function reindexDests() {
  document.querySelectorAll('.dest-block').forEach((b, i) => {
    b.querySelector('.db-label').textContent = `Destino ${i + 1}`;
  });
}

function updateWTotal() {
  const inputs = document.querySelectorAll('[name^="dw_"]');
  const total = Array.from(inputs).reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
  const span = document.getElementById('wtotal');
  if (!span) return;
  span.textContent = total.toFixed(1) + '%';
  span.className = 'wval ' + (Math.abs(total - 100) <= 0.5 ? 'ok' : 'bad');
}

function updateAddBtn() {
  const btn = document.getElementById('add-dest-btn');
  if (btn) btn.disabled = document.querySelectorAll('.dest-block').length >= 4;
}

async function submitCreate(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = form.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Criando...';

  const get = n => form.querySelector(`[name="${n}"]`)?.value || '';

  const blocks = document.querySelectorAll('.dest-block');
  const destinations = Array.from(blocks).map(b => {
    const id = b.dataset.did;
    return { url: get(`du_${id}`), src: get(`ds_${id}`), weight: parseFloat(get(`dw_${id}`)) || 0 };
  });

  try {
    const r = await api.post('/api/campaigns', {
      name: get('name'),
      domain_url: get('domain_url'),
      destinations
    });
    if (r.error) { toast(r.error, 'error'); btn.disabled = false; btn.textContent = 'Criar Campanha'; return; }
    toast('Campanha criada!', 'success');
    navigate('/campaign/' + r.id);
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Criar Campanha';
  }
}

// ─── Edit Campaign ────────────────────────────────────────────────────────────

async function viewEdit(app, id) {
  app.innerHTML = spinner();
  try {
    const camp = await api.get(`/api/campaigns/${id}`);
    if (camp.error) { app.innerHTML = errorBlock(camp.error); return; }

    _destId = 0;

    app.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="back-btn" onclick="navigate('/campaign/${id}')">←</button>
          <h1>Editar Campanha</h1>
        </div>
      </div>
      <form id="edit-form" class="form-card" onsubmit="submitEdit(event,${id})">

        <fieldset class="fs">
          <legend>Informações Gerais</legend>
          <div class="fg">
            <label>Nome da Campanha *</label>
            <input name="name" required class="fi" value="${esc(camp.name)}" placeholder="Ex: Produto X — Split Teste">
          </div>
          <div class="fg">
            <label>URL do Domínio Principal *</label>
            <input name="domain_url" type="url" required class="fi" value="${esc(camp.domain_url)}" placeholder="https://seudominio.com">
            <small>Onde o redirect gerado ficará hospedado</small>
          </div>
        </fieldset>

        <fieldset class="fs">
          <div class="fs-head">
            <legend>Destinos</legend>
            <button type="button" id="add-dest-btn" class="btn btn-ghost btn-sm" onclick="addDest()">+ Destino</button>
          </div>
          <div id="dests"></div>
          <div class="weight-total">Total: <span id="wtotal" class="wval">0%</span></div>
        </fieldset>

        <div class="form-actions">
          <a href="#/campaign/${id}" class="btn btn-ghost">Cancelar</a>
          <button type="submit" class="btn btn-primary">Salvar Alterações</button>
        </div>
      </form>`;

    for (const d of camp.destinations) addDestWithValues(d.url, d.src, d.weight);
  } catch (e) {
    app.innerHTML = errorBlock('Erro ao carregar campanha: ' + e.message);
  }
}

function addDestWithValues(url, src, weight) {
  const container = document.getElementById('dests');
  const count = container.querySelectorAll('.dest-block').length;
  if (count >= 4) return;

  const id = _destId++;
  const el = document.createElement('div');
  el.className = 'dest-block';
  el.dataset.did = id;
  el.innerHTML = `
    <div class="db-head">
      <span class="db-label">Destino ${count + 1}</span>
      <button type="button" class="btn-rm" onclick="removeDest(${id})">✕</button>
    </div>
    <div class="frow frow-dests">
      <div class="fg fg-url">
        <label>URL *</label>
        <input type="url" name="du_${id}" required class="fi" value="${esc(url)}" placeholder="https://oferta.com/pagina">
      </div>
      <div class="fg fg-src">
        <label>Parâmetro *</label>
        <input type="text" name="ds_${id}" required class="fi" value="${esc(src)}" placeholder="ex: src=pv3">
      </div>
      <div class="fg fg-w">
        <label>% Tráfego *</label>
        <input type="number" name="dw_${id}" required min="0.1" max="100" step="0.1" value="${weight}" class="fi" oninput="updateWTotal()">
      </div>
    </div>`;
  container.appendChild(el);
  reindexDests();
  updateWTotal();
  updateAddBtn();
}

async function submitEdit(e, id) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const get = n => form.querySelector(`[name="${n}"]`)?.value || '';

  const blocks = document.querySelectorAll('.dest-block');
  const destinations = Array.from(blocks).map(b => {
    const did = b.dataset.did;
    return { url: get(`du_${did}`), src: get(`ds_${did}`), weight: parseFloat(get(`dw_${did}`)) || 0 };
  });

  try {
    const r = await api.put(`/api/campaigns/${id}`, {
      name: get('name'),
      domain_url: get('domain_url'),
      destinations
    });
    if (r.error) { toast(r.error, 'error'); btn.disabled = false; btn.textContent = 'Salvar Alterações'; return; }
    toast('Campanha atualizada!', 'success');
    navigate('/campaign/' + id);
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Salvar Alterações';
  }
}

// ─── Campaign Dashboard ───────────────────────────────────────────────────────

async function viewDashboard(app, id) {
  app.innerHTML = spinner();
  try {
    const [camp, stats] = await Promise.all([
      api.get(`/api/campaigns/${id}`),
      api.get(`/api/campaigns/${id}/stats`)
    ]);
    if (camp.error) { app.innerHTML = errorBlock(camp.error); return; }

    const totalRev   = stats.destinations.reduce((s, d) => s + d.revenue, 0);
    const totalSales = stats.destinations.reduce((s, d) => s + d.sales,   0);
    const avgConv    = stats.totalClicks > 0
      ? ((totalSales / stats.totalClicks) * 100).toFixed(2) : '0.00';

    const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444'];

    app.innerHTML = `
      <div class="dash-header">
        <div class="dash-title">
          <button class="back-btn" onclick="navigate('/')">←</button>
          <div>
            <h1>${esc(camp.name)}</h1>
            <span class="dash-domain">🌐 ${esc(camp.domain_url)}</span>
          </div>
        </div>
        <div class="dash-actions">
          <button class="btn btn-secondary" onclick="downloadRedirect(${id})">⬇ Gerar Redirect</button>
          <button class="btn btn-ghost" onclick="navigate('/campaign/${id}/edit')">✎ Editar</button>
          <button class="btn btn-ghost" onclick="viewDashboard(document.getElementById('app'), ${id})">↺ Atualizar</button>
        </div>
      </div>

      ${stats.utmifyError ? `<div class="alert alert-warn">⚠ ${esc(stats.utmifyError)}</div>` : ''}
      ${!stats.utmifyConnected && camp.utmify_dashboard_id
        ? `<div class="alert alert-info">💡 Configure o token Utmify em <a href="#/settings">Configurações</a> para ver faturamento.</div>`
        : ''}

      <div class="kpi-grid">
        ${kpi('👆', stats.totalClicks.toLocaleString('pt-BR'), 'Cliques Recebidos', 'primary')}
        ${kpi('💰', fmtBRL(totalRev),  'Faturamento Total')}
        ${kpi('🛍', totalSales.toLocaleString('pt-BR'), 'Vendas')}
        ${kpi('📈', avgConv + '%', 'Conversão Geral')}
      </div>

      <div class="section-card">
        <h2>Performance por Destino</h2>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Destino</th>
                <th>SRC</th>
                <th>Peso</th>
                <th class="r">Cliques</th>
                <th class="r">% Real</th>
                <th class="r">Faturamento</th>
                <th class="r">Vendas</th>
                <th class="r">Reemb.</th>
                <th class="r">Conversão</th>
                <th class="r">Rev/Click</th>
              </tr>
            </thead>
            <tbody>
              ${stats.destinations.map((d, i) => `
                <tr>
                  <td>
                    <div class="dest-name-cell">
                      <span class="dbadge" style="background:${COLORS[i]}">${i+1}</span>
                      <a href="${esc(d.url)}" target="_blank" class="tbl-link" title="${esc(d.url)}">${truncUrl(d.url)}</a>
                    </div>
                  </td>
                  <td><code class="src-tag">${esc(d.src)}</code></td>
                  <td><span class="w-tag">${d.weight}%</span></td>
                  <td class="r">${d.clicks.toLocaleString('pt-BR')}</td>
                  <td class="r">${d.pctReal}%</td>
                  <td class="r ${d.revenue>0?'pos':''}">${fmtBRL(d.revenue)}</td>
                  <td class="r">${d.sales}</td>
                  <td class="r ${d.refunds>0?'neg':''}">${d.refunds}</td>
                  <td class="r">${d.conversion}%</td>
                  <td class="r">${fmtBRL(d.revenuePerClick)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="charts-row">
        <div class="chart-card">
          <h3>Distribuição de Cliques</h3>
          <canvas id="ch-donut" height="240"></canvas>
        </div>
        <div class="chart-card">
          <h3>Faturamento por Destino</h3>
          <canvas id="ch-rev" height="240"></canvas>
        </div>
      </div>

      <div class="section-card">
        <h3 style="margin-bottom:16px">Cliques (últimos 30 dias)</h3>
        <canvas id="ch-line" height="100"></canvas>
      </div>

      <!-- Payt Sales Panel -->
      <div class="section-card">
        <h2>Vendas por Webhook Payt ${stats.localSalesActive
          ? '<span class="badge-live">&#x25CF; ao vivo</span>'
          : '<span class="badge-off">sem dados</span>'}</h2>
        ${stats.localSalesActive ? `
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th>Destino</th><th>SRC</th>
              <th class="r">Aprovadas</th><th class="r">Faturamento</th>
              <th class="r">Reembolsos</th><th class="r">Chargeback</th>
              <th class="r">Pendentes</th><th class="r">Conversão</th>
            </tr></thead>
            <tbody>
              ${stats.destinations.map((d, i) => `
                <tr>
                  <td><div class="dest-name-cell">
                    <span class="dbadge" style="background:${COLORS[i]}">${i+1}</span>
                    <span style="color:var(--text2);font-size:.82rem">${truncUrl(d.url)}</span>
                  </div></td>
                  <td><code class="src-tag">${esc(d.src)}</code></td>
                  <td class="r pos">${d.sales}</td>
                  <td class="r ${d.revenue>0?'pos':''}">${fmtBRL(d.revenue)}</td>
                  <td class="r ${d.refunds>0?'neg':''}">${d.refunds}</td>
                  <td class="r ${(d.chargebacks||0)>0?'neg':''}">${d.chargebacks||0}</td>
                  <td class="r">${d.pending||0}</td>
                  <td class="r">${d.conversion}%</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${stats.orphanSales?.total > 0 ? `
          <div class="alert alert-warn" style="margin-top:12px">
            ⚠ ${stats.orphanSales.total} venda(s) com src não mapeado (${fmtBRL(stats.orphanSales.revenue)} aprovadas).
          </div>` : ''}
        ` : `<div class="wh-empty">
          <p>Nenhuma venda recebida via webhook ainda.</p>
          <a href="#/webhook-info" class="btn btn-ghost btn-sm">Como configurar</a>
        </div>`}
      </div>

      <div class="section-card">
        <h2>Funil de Tráfego</h2>
        <div class="funnel">
          ${funnelStep('Cliques no domínio principal', stats.totalClicks, stats.totalClicks, '#475569')}
          ${stats.destinations.map((d, i) =>
            funnelStep(`Destino ${i+1} — ${d.src}`, d.clicks, stats.totalClicks, COLORS[i])
          ).join('')}
          ${stats.lostClicks > 0
            ? funnelStep('Sem destino registrado ⚠', stats.lostClicks, stats.totalClicks, '#ef4444')
            : ''}
        </div>
      </div>`;

    // Charts
    const labels = stats.destinations.map((d, i) => `D${i+1} (${d.src})`);

    _charts.donut = new Chart(document.getElementById('ch-donut'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: stats.destinations.map(d => d.clicks), backgroundColor: COLORS, borderWidth: 2, borderColor: '#ffffff' }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#64748b', padding: 14, font: { size: 12 } } }
        }
      }
    });

    _charts.rev = new Chart(document.getElementById('ch-rev'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Faturamento', data: stats.destinations.map(d => d.revenue), backgroundColor: COLORS, borderRadius: 6 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#64748b', callback: v => 'R$' + v }, grid: { color: '#f1f5f9' } },
          x: { ticks: { color: '#64748b' }, grid: { display: false } }
        }
      }
    });

    // Build time series datasets
    const allDates = [...new Set(stats.timeSeries.map(r => r.date))].sort();
    const lineDatasets = stats.destinations.map((d, i) => {
      const map = Object.fromEntries(
        stats.timeSeries.filter(r => r.destination_id === d.id).map(r => [r.date, r.n])
      );
      return {
        label: `D${i+1} (${d.src})`,
        data: allDates.map(date => map[date] || 0),
        borderColor: COLORS[i],
        backgroundColor: COLORS[i] + '22',
        tension: 0.3,
        fill: true,
        pointRadius: 3
      };
    });

    _charts.line = new Chart(document.getElementById('ch-line'), {
      type: 'line',
      data: { labels: allDates, datasets: lineDatasets },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#64748b', font: { size: 12 } } } },
        scales: {
          y: { ticks: { color: '#64748b' }, grid: { color: '#f1f5f9' } },
          x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { display: false } }
        }
      }
    });

  } catch (e) {
    app.innerHTML = errorBlock('Erro ao carregar dashboard: ' + e.message);
  }
}

function funnelStep(label, count, total, color) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
  const width = Math.max(parseFloat(pct), 8);
  return `
    <div class="funnel-row">
      <div class="funnel-bar" style="width:${width}%;background:${color}20;border-left:3px solid ${color}">
        <span class="funnel-lbl">${label}</span>
        <span class="funnel-cnt">${count.toLocaleString('pt-BR')} <small>(${pct}%)</small></span>
      </div>
    </div>`;
}

// ─── Webhook Info ─────────────────────────────────────────────────────────────

async function viewWebhookInfo(app) {
  const settings = await api.get('/api/settings');
  const serverUrl = settings.server_url || 'http://localhost:3000';
  const webhookUrl = `${serverUrl}/webhook/payt`;

  const payloadExample = JSON.stringify({
    id: "TXN-123456",
    event: "sale.approved",
    status: "approved",
    created_at: "2024-01-01 12:00:00",
    total: 197.00,
    currency: "BRL",
    payment_method: "credit_card",
    installments: 1,
    product: { id: "prod-abc", name: "Produto X" },
    offer:   { id: "offer-abc", name: "Oferta A" },
    customer: {
      name: "João Silva",
      email: "joao@email.com",
      phone: "11999999999",
      document: "123.456.789-00"
    },
    utm: {
      src: "oferta-a",
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "campanha-x",
      utm_content: "creative-1",
      utm_term: ""
    }
  }, null, 2);

  const statusList = [
    ['approved',   'Venda aprovada / finalizada', 'pos'],
    ['refunded',   'Reembolso efetuado',           'neg'],
    ['chargeback', 'Chargeback',                   'neg'],
    ['cancelled',  'Cancelada',                     ''],
    ['pending',    'Aguardando pagamento',          ''],
  ];

  app.innerHTML = `
    <div class="page-header">
      <h1>Webhook Payt</h1>
    </div>

    <div class="wh-grid">
      <div class="section-card">
        <h2>URL do Endpoint</h2>
        <div class="wh-url-row">
          <span class="method-badge">POST</span>
          <code class="wh-url" id="wh-url-text">${esc(webhookUrl)}</code>
          <button class="btn btn-ghost btn-sm" onclick="copyWebhookUrl()">Copiar</button>
        </div>
        <p class="wh-hint">Cole esta URL no campo <strong>Postback URL</strong> dentro de cada produto na Payt
          (Produto → Postbacks → Cadastrar). Selecione os eventos
          <strong>Finalizada/Aprovada</strong>, <strong>Cancelada-Reembolsada</strong> e
          <strong>Cancelada-Chargeback</strong>.</p>
      </div>

      <div class="section-card">
        <h2>Status reconhecidos</h2>
        <table class="tbl">
          <thead><tr><th>Status</th><th>Significado</th></tr></thead>
          <tbody>
            ${statusList.map(([s, label, cls]) => `
              <tr>
                <td><code class="src-tag ${cls}">${s}</code></td>
                <td style="color:var(--text2)">${label}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-card">
      <h2>Como o src é extraído</h2>
      <p class="wh-hint" style="margin-bottom:14px">
        O MetaSplit tenta extrair o <code class="src-tag">src</code> nesta ordem de prioridade:
      </p>
      <ol class="wh-priority">
        <li><code>utm.src</code> — campo nativo Payt (V1)</li>
        <li><code>utm.utm_source</code></li>
        <li><code>utm.utm_content</code></li>
        <li><code>src</code> na raiz (formato V1 Flat)</li>
        <li><code>utm_source</code> na raiz (formato V1 Flat)</li>
      </ol>
      <p class="wh-hint" style="margin-top:12px">
        O <strong>src encontrado é cruzado com os destinos cadastrados</strong> nas suas campanhas.
        Vendas cujo src não casar com nenhum destino são salvas como "órfãs" e aparecem no dashboard.
      </p>
    </div>

    <div class="section-card">
      <h2>Payload de exemplo (Payt V1)</h2>
      <div class="wh-code-wrap">
        <button class="btn btn-ghost btn-sm wh-copy-code" onclick="copyPayload()">Copiar</button>
        <pre id="payload-pre" class="wh-code">${esc(payloadExample)}</pre>
      </div>
    </div>

    <div class="section-card">
      <h2>Testar webhook</h2>
      <p class="wh-hint" style="margin-bottom:14px">Dispara um evento de teste para a campanha selecionada.</p>
      <div class="frow" style="align-items:flex-end;gap:12px;flex-wrap:wrap">
        <div class="fg">
          <label>Campanha / SRC</label>
          <select id="test-campaign-select" class="fi"></select>
        </div>
        <div class="fg fg-src">
          <label>Status</label>
          <select id="test-status-select" class="fi">
            <option value="approved">approved</option>
            <option value="refunded">refunded</option>
            <option value="pending">pending</option>
            <option value="chargeback">chargeback</option>
          </select>
        </div>
        <div class="fg fg-w">
          <label>Valor (R$)</label>
          <input type="number" id="test-amount" class="fi" value="197" min="0" step="0.01">
        </div>
        <button class="btn btn-primary" onclick="fireTestWebhook()">Disparar teste</button>
      </div>
      <div id="test-result" style="margin-top:14px"></div>
    </div>`;

  // Preenche select de campanhas/destinos
  loadTestCampaigns();
}

async function loadTestCampaigns() {
  const sel = document.getElementById('test-campaign-select');
  if (!sel) return;
  try {
    const campaigns = await api.get('/api/campaigns');
    sel.innerHTML = '';
    for (const c of campaigns) {
      const dets = await api.get(`/api/campaigns/${c.id}`);
      for (const d of dets.destinations) {
        const opt = document.createElement('option');
        opt.value = d.src;
        opt.textContent = `${esc(c.name)} → ${d.src} (${d.weight}%)`;
        sel.appendChild(opt);
      }
    }
    if (!sel.options.length) sel.innerHTML = '<option value="">Nenhuma campanha cadastrada</option>';
  } catch {}
}

async function fireTestWebhook() {
  const src    = document.getElementById('test-campaign-select')?.value;
  const status = document.getElementById('test-status-select')?.value || 'approved';
  const amount = parseFloat(document.getElementById('test-amount')?.value) || 197;
  const resultEl = document.getElementById('test-result');
  if (!src) { toast('Selecione um destino primeiro.', 'error'); return; }

  const payload = {
    id: `TEST-${Date.now()}`,
    event: `sale.${status}`,
    status,
    created_at: new Date().toISOString(),
    total: amount,
    currency: 'BRL',
    payment_method: 'credit_card',
    product: { name: 'Produto de Teste' },
    customer: { name: 'Teste MetaSplit', email: 'teste@metasplit.com' },
    utm: { src, utm_source: 'test', utm_medium: 'webhook-test' }
  };

  try {
    const r = await fetch('/webhook/payt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (resultEl) resultEl.innerHTML = `
      <div class="alert alert-info">
        ✅ Webhook disparado — ação: <strong>${data.action}</strong>,
        id: <strong>${data.id}</strong>,
        campaign_id: <strong>${data.campaign_id ?? 'não encontrado (src sem campanha)'}</strong>
      </div>`;
    toast('Webhook de teste enviado!', 'success');
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function copyWebhookUrl() {
  const url = document.getElementById('wh-url-text')?.textContent || '';
  navigator.clipboard.writeText(url).then(() => toast('URL copiada!', 'success'));
}

function copyPayload() {
  const txt = document.getElementById('payload-pre')?.textContent || '';
  navigator.clipboard.writeText(txt).then(() => toast('Payload copiado!', 'success'));
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function viewSettings(app) {
  app.innerHTML = spinner();
  try {
    const s = await api.get('/api/settings');
    app.innerHTML = `
      <div class="page-header"><h1>Configurações</h1></div>
      <form id="settings-form" class="form-card" onsubmit="saveSettings(event)">

        <fieldset class="fs">
          <legend>Integração Utmify</legend>
          <div class="fg">
            <label>Bearer Token</label>
            <input type="password" name="utmify_token" value="${esc(s.utmify_token||'')}" class="fi" placeholder="Seu token de API da Utmify">
            <small>Encontre em Utmify → Integrações → Credenciais de API</small>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Servidor SplitTrack</legend>
          <div class="fg">
            <label>URL Pública do Servidor</label>
            <input type="url" name="server_url" value="${esc(s.server_url||'http://localhost:3000')}" class="fi" placeholder="https://splittrack.seudominio.com">
            <small>Usado para montar o endpoint de tracking nos redirects gerados</small>
          </div>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Salvar Configurações</button>
        </div>
      </form>`;
  } catch (e) {
    app.innerHTML = errorBlock('Erro ao carregar configurações: ' + e.message);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Salvando...';
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v; });
  try {
    await api.post('/api/settings', data);
    toast('Configurações salvas!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar Configurações';
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function downloadRedirect(id) {
  try {
    const r = await fetch(`/api/campaigns/${id}/generate`);
    if (!r.ok) { toast('Erro ao gerar redirect.', 'error'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'index.html' });
    a.click();
    URL.revokeObjectURL(url);
    toast('Redirect gerado! Faça upload do index.html para o seu domínio.', 'success');
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

function confirmDelete(id, name) {
  if (!confirm(`Deletar "${name}"? Todos os dados serão perdidos.`)) return;
  api.del(`/api/campaigns/${id}`)
    .then(() => { toast('Campanha deletada.', 'success'); viewCampaignList(document.getElementById('app')); })
    .catch(e => toast('Erro: ' + e.message, 'error'));
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function kpi(icon, val, label, cls = '') {
  return `
    <div class="kpi-card ${cls}">
      <div class="kpi-icon">${icon}</div>
      <div>
        <div class="kpi-val">${val}</div>
        <div class="kpi-lbl">${label}</div>
      </div>
    </div>`;
}

function spinner() {
  return `<div class="spin-wrap"><div class="spinner"></div></div>`;
}

function errorBlock(msg) {
  return `<div class="alert alert-err">${esc(msg)}</div>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtBRL(v) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v || 0);
}

function truncUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 18 ? u.pathname.slice(0,18) + '…' : u.pathname;
    return u.hostname + (path === '/' ? '' : path);
  } catch { return url.slice(0, 30) + '…'; }
}

function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}
