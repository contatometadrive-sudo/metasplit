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
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  handleRoute();
});

// ─── Theme ────────────────────────────────────────────────────────────────────

function initTheme() {
  if (localStorage.getItem('theme') === 'dark') applyDark();
}

function applyDark() {
  document.body.classList.add('dark');
  const sun  = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  const lbl  = document.getElementById('theme-label');
  if (sun)  sun.style.display  = 'none';
  if (moon) moon.style.display = '';
  if (lbl)  lbl.textContent    = 'Tema claro';
}

function applyLight() {
  document.body.classList.remove('dark');
  const sun  = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  const lbl  = document.getElementById('theme-label');
  if (sun)  sun.style.display  = '';
  if (moon) moon.style.display = 'none';
  if (lbl)  lbl.textContent    = 'Tema escuro';
}

function toggleTheme() {
  if (document.body.classList.contains('dark')) {
    applyLight();
    localStorage.setItem('theme', 'light');
  } else {
    applyDark();
    localStorage.setItem('theme', 'dark');
  }
}

// ─── Campaign List ────────────────────────────────────────────────────────────

const HERO_HTML = `
  <div class="homepage-hero">
    <div class="hero-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    </div>
    <h1 class="hero-title">MetaSplit</h1>
    <p class="hero-tagline">Teste e compare suas ofertas com split de tráfego inteligente</p>
  </div>`;

async function viewCampaignList(app) {
  app.innerHTML = spinner();
  try {
    const campaigns = await api.get('/api/campaigns');
    if (!campaigns.length) {
      app.innerHTML = HERO_HTML + `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <h2>Nenhuma campanha ainda</h2>
          <p>Crie seu primeiro split test e comece a otimizar</p>
          <a href="#/create" class="btn btn-primary">+ Nova Campanha</a>
        </div>`;
      return;
    }
    app.innerHTML = HERO_HTML + `
      <div class="page-header">
        <h2>Campanhas</h2>
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
  const conv = c.total_clicks > 0
    ? ((c.total_sales / c.total_clicks) * 100).toFixed(2)
    : '0.00';
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
          <button class="icon-btn" title="Resetar dados" onclick="confirmReset(${c.id}, '${esc(c.name)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
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
      <div class="cc-stats-grid">
        <div class="cc-stat">
          <span class="cc-stat-val">${(c.total_clicks || 0).toLocaleString('pt-BR')}</span>
          <span class="cc-stat-lbl">Cliques</span>
        </div>
        <div class="cc-stat">
          <span class="cc-stat-val cc-stat-green">${fmtBRL(c.total_revenue || 0)}</span>
          <span class="cc-stat-lbl">Faturamento</span>
        </div>
        <div class="cc-stat">
          <span class="cc-stat-val">${(c.total_sales || 0).toLocaleString('pt-BR')}</span>
          <span class="cc-stat-lbl">Vendas</span>
        </div>
        <div class="cc-stat">
          <span class="cc-stat-val">${conv}%</span>
          <span class="cc-stat-lbl">Conversão</span>
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
          <input name="domain_url" type="text" required class="fi" placeholder="seudominio.com ou https://seudominio.com" onblur="sanitizeDomainInput(this)">
          <small>Onde o redirect gerado ficará hospedado (https:// será adicionado automaticamente)</small>
        </div>
        <div class="fg">
          <label>Produto (opcional)</label>
          <input name="product_filter" type="text" class="fi" placeholder="Ex: Curso Premium">
          <small>Se preenchido, o webhook só registra vendas cujo nome do produto contenha este texto (case-insensitive). Útil quando um mesmo src vende mais de um produto.</small>
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
      domain_url: normalizeDomainUrl(get('domain_url')),
      product_filter: get('product_filter'),
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
            <input name="domain_url" type="text" required class="fi" value="${esc(camp.domain_url)}" placeholder="seudominio.com ou https://seudominio.com" onblur="sanitizeDomainInput(this)">
            <small>Onde o redirect gerado ficará hospedado (https:// será adicionado automaticamente)</small>
          </div>
          <div class="fg">
            <label>Produto (opcional)</label>
            <input name="product_filter" type="text" class="fi" value="${esc(camp.product_filter || '')}" placeholder="Ex: Curso Premium">
            <small>Se preenchido, o webhook só registra vendas cujo nome do produto contenha este texto (case-insensitive). Útil quando um mesmo src vende mais de um produto.</small>
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
      domain_url: normalizeDomainUrl(get('domain_url')),
      product_filter: get('product_filter'),
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
  id = +id;
  drpEnsureInit(id);
  const ds = _drp[id];
  const startStr = ds.start ? drpDateStr(ds.start) : null;
  const endStr   = ds.end   ? drpDateStr(ds.end)   : null;
  const statsUrl = startStr && endStr
    ? `/api/campaigns/${id}/stats?start=${startStr}&end=${endStr}`
    : `/api/campaigns/${id}/stats`;

  app.innerHTML = spinner();
  try {
    const [camp, stats] = await Promise.all([
      api.get(`/api/campaigns/${id}`),
      api.get(statsUrl)
    ]);
    if (camp.error) { app.innerHTML = errorBlock(camp.error); return; }

    const totalRev   = stats.destinations.reduce((s, d) => s + d.revenue, 0);
    const totalSales = stats.destinations.reduce((s, d) => s + d.sales,   0);
    const avgConv    = stats.totalClicks > 0
      ? ((totalSales / stats.totalClicks) * 100).toFixed(2) : '0.00';

    const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444'];

    const withSales = stats.destinations.filter(d => d.clicks > 0);
    const winnerId = withSales.length > 0
      ? withSales.reduce((best, d) =>
          d.conversion > best.conversion || (d.conversion === best.conversion && d.revenue > best.revenue) ? d : best
        , withSales[0]).id
      : null;

    const bestOfferSection = stats.destinations.some(d => d.clicks > 0) ? `
      <div class="section-card">
        <h3>Qual oferta converte mais?</h3>
        <div class="best-offer-grid">
          ${stats.destinations.map((d, i) => {
            const isWinner = d.id === winnerId;
            return `
              <div class="best-offer-card${isWinner ? ' best-offer-winner' : ''}">
                ${isWinner ? '<div class="best-offer-trophy">🏆 Melhor oferta</div>' : ''}
                <div class="boc-header">
                  <span class="dbadge" style="background:${COLORS[i]}">${i+1}</span>
                  <div class="boc-title">${truncUrl(d.url)}</div>
                </div>
                <div class="boc-stats">
                  <div class="boc-stat">
                    <div class="boc-val${isWinner?' boc-win':''}">${d.conversion}%</div>
                    <div class="boc-lbl">Conversão</div>
                  </div>
                  <div class="boc-stat">
                    <div class="boc-val">${d.clicks.toLocaleString('pt-BR')}</div>
                    <div class="boc-lbl">Cliques</div>
                  </div>
                  <div class="boc-stat">
                    <div class="boc-val">${d.sales}</div>
                    <div class="boc-lbl">Vendas</div>
                  </div>
                  <div class="boc-stat">
                    <div class="boc-val">${fmtBRL(d.revenue)}</div>
                    <div class="boc-lbl">Faturamento</div>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    app.innerHTML = `
      <div class="dash-header">
        <div class="dash-title">
          <button class="back-btn" onclick="navigate('/')">←</button>
          <div>
            <h1>${esc(camp.name)}</h1>
            <span class="dash-domain">🌐 ${esc(camp.domain_url)}</span>
            ${camp.product_filter ? `
              <span class="dash-product-filter" title="Webhook só registra vendas cujo product.name contenha este texto">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Produto: <strong>${esc(camp.product_filter)}</strong>
              </span>` : ''}
          </div>
        </div>
        <div class="dash-actions">
          <button class="btn btn-secondary" onclick="downloadRedirect(${id})">⬇ Gerar Redirect</button>
          <button class="btn btn-ghost" onclick="navigate('/campaign/${id}/edit')">✎ Editar</button>
          <button class="btn btn-ghost" onclick="resetFromDashboard(${id},'${esc(camp.name)}')">⟳ Resetar</button>
          <button class="btn btn-ghost" onclick="viewDashboard(document.getElementById('app'),${id})">↺ Atualizar</button>
        </div>
      </div>

      <div class="drp-wrap" id="drp-${id}">
        <button class="drp-field" onclick="drpToggle(${id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span id="drp-label-${id}">Todo o período</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="drp-panel" id="drp-panel-${id}" style="display:none"></div>
      </div>

      <div class="kpi-grid">
        ${kpi('👆', stats.totalClicks.toLocaleString('pt-BR'), 'Cliques Recebidos', 'primary')}
        ${kpi('💰', fmtBRL(totalRev), 'Faturamento Total')}
        ${kpi('🛍', totalSales.toLocaleString('pt-BR'), 'Vendas')}
        ${kpi('📈', avgConv + '%', 'Conversão Geral')}
      </div>

      <div class="dest-comp-grid">
        ${stats.destinations.map((d, i) => `
          <div class="dest-comp-card">
            <div class="dcc-header">
              <span class="dbadge" style="background:${COLORS[i]}">${i+1}</span>
              <div class="dcc-info">
                <a href="${esc(d.url)}" target="_blank" class="dcc-url" title="${esc(d.url)}">${truncUrl(d.url)}</a>
                <div><code class="src-tag">${esc(d.src)}</code><span class="w-tag" style="margin-left:6px">${d.weight}%</span></div>
              </div>
            </div>
            <div class="dcc-stats">
              <div class="dcc-stat">
                <span class="dcc-val">${d.clicks.toLocaleString('pt-BR')}</span>
                <span class="dcc-lbl">Cliques</span>
              </div>
              <div class="dcc-stat">
                <span class="dcc-val ${d.revenue>0?'pos':''}">${fmtBRL(d.revenue)}</span>
                <span class="dcc-lbl">Faturamento</span>
              </div>
              <div class="dcc-stat">
                <span class="dcc-val">${d.sales}</span>
                <span class="dcc-lbl">Vendas</span>
              </div>
              <div class="dcc-stat">
                <span class="dcc-val">${d.conversion}%</span>
                <span class="dcc-lbl">Conversão</span>
              </div>
            </div>
          </div>`).join('')}
      </div>

      <div class="section-card">
        <h3>Funil de Distribuição</h3>
        ${renderYFunnel(stats.totalClicks, stats.destinations, stats.lostClicks, COLORS)}
      </div>

      ${bestOfferSection}

      ${stats.orphanSales?.total > 0 ? `
        <div class="alert alert-warn">
          ⚠ ${stats.orphanSales.total} venda(s) aprovada(s) com parâmetro não mapeado (${fmtBRL(stats.orphanSales.revenue)}).
        </div>` : ''}`;

    drpUpdateLabel(id);

  } catch (e) {
    app.innerHTML = errorBlock('Erro ao carregar dashboard: ' + e.message);
  }
}

// ─── Date Range Picker ────────────────────────────────────────────────────────

const _drp = {};
const _DRP_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const _DRP_DOWS   = ['D','S','T','Q','Q','S','S'];

function drpDateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function drpFmt(d) {
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function drpEnsureInit(id) {
  if (!_drp[id]) {
    const now = new Date();
    _drp[id] = { start: null, end: null, phase: 'start', month: now.getMonth(), year: now.getFullYear() };
  }
}

function drpUpdateLabel(id) {
  const lbl = document.getElementById(`drp-label-${id}`);
  if (!lbl) return;
  const s = _drp[id];
  lbl.textContent = s && s.start && s.end
    ? `${drpFmt(s.start)} – ${drpFmt(s.end)}`
    : 'Todo o período';
}

let _drpOutsideHandler = null;

function drpToggle(id) {
  const panel = document.getElementById(`drp-panel-${id}`);
  if (!panel) return;
  panel.style.display === 'none' ? drpOpen(id) : drpClose(id);
}

function drpOpen(id) {
  drpEnsureInit(id);
  const panel = document.getElementById(`drp-panel-${id}`);
  if (!panel) return;
  panel.style.display = '';
  drpRender(id);
  if (_drpOutsideHandler) document.removeEventListener('click', _drpOutsideHandler);
  _drpOutsideHandler = e => {
    const wrap = document.getElementById(`drp-${id}`);
    if (wrap && !wrap.contains(e.target)) {
      drpClose(id);
      document.removeEventListener('click', _drpOutsideHandler);
      _drpOutsideHandler = null;
    }
  };
  setTimeout(() => document.addEventListener('click', _drpOutsideHandler), 0);
}

function drpClose(id) {
  const panel = document.getElementById(`drp-panel-${id}`);
  if (panel) panel.style.display = 'none';
}

function drpRender(id) {
  const panel = document.getElementById(`drp-panel-${id}`);
  if (!panel) return;
  const s     = _drp[id];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(s.year, s.month, 1);
  const last  = new Date(s.year, s.month + 1, 0);

  let cells = _DRP_DOWS.map(d => `<div class="drp-dow">${d}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(s.year, s.month, d);
    const ts   = date.getTime();
    let cls    = 'drp-day';
    if (s.start && ts === s.start.getTime()) cls += ' drp-start';
    if (s.end   && ts === s.end.getTime())   cls += ' drp-end';
    if (s.start && s.end && date > s.start && date < s.end) cls += ' drp-in-range';
    if (ts === today.getTime()) cls += ' drp-today';
    cells += `<div class="${cls}" onclick="drpDayClick(${id},'${drpDateStr(date)}')">${d}</div>`;
  }

  const hintText = s.start && s.end
    ? `${drpFmt(s.start)} → ${drpFmt(s.end)}`
    : s.start ? 'Selecione a data final' : 'Selecione a data inicial';

  panel.innerHTML = `
    <div class="drp-inner">
      <div class="drp-presets">
        <button class="drp-preset" onclick="drpPreset(${id},'today')">Hoje</button>
        <button class="drp-preset" onclick="drpPreset(${id},'yesterday')">Ontem</button>
        <button class="drp-preset" onclick="drpPreset(${id},'7d')">7 dias</button>
        <button class="drp-preset" onclick="drpPreset(${id},'30d')">30 dias</button>
        <button class="drp-preset" onclick="drpPreset(${id},'all')">Tudo</button>
      </div>
      <div class="drp-cal">
        <div class="drp-nav">
          <button class="drp-nav-btn" onclick="drpPrev(${id})">&#8249;</button>
          <span class="drp-month-lbl">${_DRP_MONTHS[s.month]} ${s.year}</span>
          <button class="drp-nav-btn" onclick="drpNext(${id})">&#8250;</button>
        </div>
        <div class="drp-grid">${cells}</div>
        <div class="drp-footer">
          <span class="drp-hint">${hintText}</span>
          ${s.start && s.end ? `<button class="drp-apply-btn" onclick="drpApply(${id})">Aplicar</button>` : ''}
        </div>
      </div>
    </div>`;
}

function drpDayClick(id, dateStr) {
  const s    = _drp[id];
  const date = new Date(dateStr + 'T00:00:00');
  if (s.phase === 'start' || (s.start && s.end)) {
    s.start = date; s.end = null; s.phase = 'end';
  } else {
    if (date < s.start) { s.end = s.start; s.start = date; }
    else s.end = date;
    s.phase = 'start';
  }
  drpRender(id);
}

function drpPrev(id) {
  const s = _drp[id];
  if (s.month === 0) { s.month = 11; s.year--; } else s.month--;
  drpRender(id);
}

function drpNext(id) {
  const s = _drp[id];
  if (s.month === 11) { s.month = 0; s.year++; } else s.month++;
  drpRender(id);
}

function drpPreset(id, preset) {
  const s     = _drp[id];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (preset === 'today') {
    s.start = new Date(today); s.end = new Date(today);
  } else if (preset === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    s.start = y; s.end = new Date(y.getTime());
  } else if (preset === '7d') {
    s.end = new Date(today);
    s.start = new Date(today); s.start.setDate(s.start.getDate() - 6);
  } else if (preset === '30d') {
    s.end = new Date(today);
    s.start = new Date(today); s.start.setDate(s.start.getDate() - 29);
  } else {
    s.start = null; s.end = null;
  }
  s.phase = 'start';
  drpApply(id);
}

function drpApply(id) {
  drpClose(id);
  drpUpdateLabel(id);
  viewDashboard(document.getElementById('app'), id);
}

function renderYFunnel(totalClicks, destinations, lostClicks, COLORS) {
  if (totalClicks === 0) {
    return '<p style="text-align:center;color:var(--text3);padding:32px 0;font-size:.84rem">Sem cliques ainda para exibir o funil.</p>';
  }

  const n       = destinations.length;
  const DEST_H  = 80;
  const DEST_GAP = 22;
  const totalDestArea = n * DEST_H + (n - 1) * DEST_GAP;
  const padY    = 24;
  const lostH   = lostClicks > 0 ? 62 : 0;
  const H       = Math.max(160, totalDestArea) + padY * 2 + lostH;
  const W       = 560;

  const srcX = 0, srcW = 152, srcH = 80;
  const srcY = padY + (Math.max(160, totalDestArea) - srcH) / 2;
  const srcMidY = srcY + srcH / 2;

  const destX = 360, destW = 186;
  const destStartY = padY + (Math.max(160, totalDestArea) - totalDestArea) / 2;
  const forkX = srcX + srcW + 56;

  const destItems = destinations.map((d, i) => {
    const dy      = destStartY + i * (DEST_H + DEST_GAP);
    const dMidY   = dy + DEST_H / 2;
    const pct     = ((d.clicks / totalClicks) * 100).toFixed(1);
    const sw      = Math.max(3, Math.round((d.clicks / totalClicks) * 18));
    const c       = COLORS[i];
    const delay   = (0.1 + i * 0.18).toFixed(2);
    const srcVal  = d.src.includes('=') ? d.src.split('=')[1] : d.src;
    return `
      <path pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
        d="M${srcX+srcW} ${srcMidY} C${forkX} ${srcMidY},${forkX} ${dMidY},${destX} ${dMidY}"
        stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round"
        style="animation:drawPath .7s ${delay}s ease forwards"/>
      <rect x="${destX}" y="${dy}" width="${destW}" height="${DEST_H}" rx="8"
        fill="${c}" fill-opacity=".07" stroke="${c}" stroke-width="1.5"
        style="animation:fadeInSvg .4s ${delay}s ease forwards;opacity:0"/>
      <text x="${destX+destW/2}" y="${dy+16}" text-anchor="middle"
        font-size="10" font-weight="700" letter-spacing=".06em" fill="${c}"
        style="animation:fadeInSvg .4s ${delay}s ease forwards;opacity:0">OFERTA ${i+1}  ·  ${esc(srcVal).toUpperCase()}</text>
      <text x="${destX+destW/2}" y="${dy+46}" text-anchor="middle"
        font-size="28" font-weight="800" fill="currentColor"
        style="animation:fadeInSvg .4s ${delay}s ease forwards;opacity:0">${pct}%</text>
      <text x="${destX+destW/2}" y="${dy+65}" text-anchor="middle"
        font-size="11" fill="currentColor" opacity=".55"
        style="animation:fadeInSvg .4s ${delay}s ease forwards;opacity:0">${d.clicks.toLocaleString('pt-BR')} cliques</text>`;
  }).join('');

  const lostY = padY + Math.max(160, totalDestArea) + 14;
  const lostPct = ((lostClicks / totalClicks) * 100).toFixed(1);
  const lostBarW = Math.max(6, Math.round((lostClicks / totalClicks) * 18));
  const lostMidY = lostY + 18;
  const lostBlock = lostClicks > 0 ? `
    <path pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
      d="M${srcX+srcW} ${srcMidY} C${forkX} ${srcMidY},${forkX} ${lostMidY},${destX} ${lostMidY}"
      stroke="#ef4444" stroke-width="${lostBarW}" fill="none" stroke-linecap="round" stroke-dasharray="4,3"
      style="animation:drawPath .7s .5s ease forwards"/>
    <rect x="${destX}" y="${lostY}" width="${destW}" height="36" rx="6"
      fill="#ef4444" fill-opacity=".07" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,3"
      style="animation:fadeInSvg .4s .6s ease forwards;opacity:0"/>
    <text x="${destX+destW/2}" y="${lostY+14}" text-anchor="middle"
      font-size="10" font-weight="700" fill="#ef4444"
      style="animation:fadeInSvg .4s .6s ease forwards;opacity:0">NÃO RASTREADOS</text>
    <text x="${destX+destW/2}" y="${lostY+29}" text-anchor="middle"
      font-size="11" fill="#ef4444" opacity=".8"
      style="animation:fadeInSvg .4s .6s ease forwards;opacity:0">${lostClicks.toLocaleString('pt-BR')} cliques · ${lostPct}%</text>` : '';

  return `
    <div class="yfunnel-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:560px;overflow:visible">
        <rect x="${srcX}" y="${srcY}" width="${srcW}" height="${srcH}" rx="8"
          fill="var(--accent)" fill-opacity=".07" stroke="var(--accent)" stroke-width="1.5"/>
        <text x="${srcX+srcW/2}" y="${srcY+20}" text-anchor="middle"
          font-size="10" font-weight="700" letter-spacing=".06em" fill="var(--accent)">TOTAL CLIQUES</text>
        <text x="${srcX+srcW/2}" y="${srcY+54}" text-anchor="middle"
          font-size="30" font-weight="800" fill="currentColor">${totalClicks.toLocaleString('pt-BR')}</text>
        ${destItems}
        ${lostBlock}
      </svg>
    </div>`;
}

// ─── Webhook Info ─────────────────────────────────────────────────────────────

async function viewWebhookInfo(app) {
  const webhookUrl = 'https://metasplit.online/webhook/payt';

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
    ['approved',   'Venda aprovada — registrada',         'pos'],
    ['paid',       'Venda paga — registrada (= approved)', 'pos'],
    ['refunded',   'Reembolso — ignorado',                 'neg'],
    ['chargeback', 'Chargeback — ignorado',                'neg'],
    ['cancelled',  'Cancelada — ignorada',                  ''],
    ['canceled',   'Cancelada (US) — ignorada',             ''],
    ['expired',    'Expirada — ignorada',                   ''],
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
            <option value="paid">paid</option>
            <option value="refunded">refunded</option>
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

function confirmReset(id, name) {
  if (!confirm(`Resetar dados de "${name}"?\n\nIsso zerará todos os cliques e vendas.\nAs configurações da campanha serão mantidas.`)) return;
  api.del(`/api/campaigns/${id}/reset`)
    .then(() => { toast('Dados resetados com sucesso.', 'success'); viewCampaignList(document.getElementById('app')); })
    .catch(e => toast('Erro: ' + e.message, 'error'));
}

function resetFromDashboard(id, name) {
  if (!confirm(`Resetar dados de "${name}"?\n\nCliques e vendas serão apagados.\nAs configurações serão mantidas.`)) return;
  api.del(`/api/campaigns/${id}/reset`)
    .then(() => { toast('Dados resetados.', 'success'); viewDashboard(document.getElementById('app'), id); })
    .catch(e => toast('Erro: ' + e.message, 'error'));
}

// ─── Domain URL sanitizer ─────────────────────────────────────────────────────

function normalizeDomainUrl(val) {
  val = (val || '').trim();
  if (val && !/^https?:\/\//i.test(val)) val = 'https://' + val;
  return val.replace(/\/+$/, '');
}

function sanitizeDomainInput(input) {
  input.value = normalizeDomainUrl(input.value);
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
