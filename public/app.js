// ── tiny helpers ─────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts = {}) {
  // Only set a JSON content-type when we actually send a body — Fastify rejects
  // an empty body that's labelled application/json (breaks no-body POST/DELETE).
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location = '/login'; throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Current user / auth ──────────────────────────────────
let currentUser = null;
let authDisabled = false;
async function loadUser() {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    authDisabled = me.authDisabled;
  } catch { return; }
  const box = $('#userBox');
  if (!box) return;
  if (authDisabled) {
    box.innerHTML = '<span class="muted" style="font-size:12px">Local mode · no login</span>';
    return;
  }
  if (!currentUser) return;
  box.innerHTML =
    `<div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${esc(currentUser.email)}</div>` +
    `<a id="logoutLink" style="cursor:pointer;font-size:12px;color:var(--accent)">Log out</a>`;
  $('#logoutLink').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location = '/login';
  });
}

async function renderUsers() {
  const list = $('#userList');
  if (!list) return;
  try {
    const { users } = await api('/api/users');
    list.innerHTML = `<table style="width:100%"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${
      users.map((u) => `<tr>
        <td>${esc(u.email)}</td>
        <td>${esc(u.name) || '<span class="muted">—</span>'}</td>
        <td><span class="badge ${u.role === 'admin' ? 'ok' : 'warn'}">${u.role}</span></td>
        <td style="text-align:right">${u.id === currentUser.id
          ? '<span class="muted" style="font-size:11px">you</span>'
          : `<button class="danger sm" data-deluser="${u.id}">✕</button>`}</td>
      </tr>`).join('')
    }</tbody></table>`;
    document.querySelectorAll('[data-deluser]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this user?')) return;
      try { await api(`/api/users/${b.dataset.deluser}`, { method: 'DELETE' }); toast('User removed'); renderUsers(); }
      catch (e) { toast(e.message, 'err'); }
    }));
  } catch (e) { list.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }

  const addBtn = $('#u_add');
  if (addBtn) addBtn.onclick = async () => {
    const body = { email: $('#u_email').value.trim(), name: $('#u_name').value.trim(), password: $('#u_pass').value, role: $('#u_role').value };
    if (!body.email || !body.password) return toast('Email and password required', 'err');
    try {
      await api('/api/users', { method: 'POST', body });
      toast('User added'); $('#u_email').value = $('#u_name').value = $('#u_pass').value = '';
      renderUsers();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  setTimeout(() => (t.className = 'toast'), 3200);
}

function modal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ── routing ──────────────────────────────────────────────
const views = {};
let current = 'dashboard';
let routeParams = {};

document.querySelectorAll('nav a').forEach((a) =>
  a.addEventListener('click', () => go(a.dataset.view))
);
function go(view, params = {}) {
  current = view;
  routeParams = params;
  document.querySelectorAll('nav a[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  renderVerticalNav();
  render();
}

// Dynamic sub-menu of verticals under the Contacts nav item. Each entry scopes
// the Contacts view to one vertical; "All contacts" clears the scope.
async function renderVerticalNav() {
  const box = $('#verticalNav');
  if (!box) return;
  let data;
  try { data = await api('/api/verticals'); } catch { return; }
  const cur = current === 'contacts' ? (routeParams.vertical || '') : null;
  const item = (label, val, count) =>
    `<a class="subnav-item ${cur === val ? 'active' : ''}" data-vert="${esc(val)}">${esc(label)}<span class="vcount">${count}</span></a>`;
  box.innerHTML =
    item('All contacts', '', data.total) +
    data.verticals.map((v) => item(v.name, v.name, v.count)).join('') +
    `<a class="subnav-item add" id="newVertNav">＋ New vertical</a>`;
  box.querySelectorAll('[data-vert]').forEach((a) =>
    a.addEventListener('click', () => go('contacts', { vertical: a.dataset.vert })));
  $('#newVertNav').addEventListener('click', newVerticalPrompt);
}

async function newVerticalPrompt() {
  const name = (prompt('Name this vertical (e.g. Medical, Dental, Legal):') || '').trim();
  if (!name) return;
  try { await api('/api/verticals', { method: 'POST', body: { name } }); }
  catch (e) { return toast(e.message, 'err'); }
  toast(`Vertical “${name}” created`);
  go('contacts', { vertical: name });
}
async function render() {
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await views[current]();
  } catch (err) {
    main.innerHTML = `<div class="banner warn">Error: ${esc(err.message)}</div>`;
  }
}

async function refreshMode() {
  try {
    const s = await api('/api/health');
    window.__spacing = s.spacingSeconds;
    const pill = $('#modePill');
    pill.textContent = s.dryRun ? '🟡 DRY RUN' : '🟢 LIVE';
    pill.className = 'mode-pill ' + (s.dryRun ? 'dry' : 'live');
  } catch {}
}

// ── Dashboard ────────────────────────────────────────────
views.dashboard = async () => {
  const s = await api('/api/stats');
  const ai = await api('/api/ai/health').catch(() => ({ ok: false }));
  main.innerHTML = `
    <div class="dash-topbar">
      <div>
        <h1>Dashboard</h1>
        <p class="subtitle">Overview of your email campaigns and automation performance.</p>
      </div>
      <div class="dash-search">⌕ <span>Search contacts, campaigns, templates...</span><kbd>⌘ K</kbd></div>
      <div class="dash-profile"><span class="avatar">${esc((currentUser?.name || currentUser?.email || 'M').slice(0, 1).toUpperCase())}</span><div><b>${esc(currentUser?.name || 'Micah')}</b><small>${esc(currentUser?.email || 'Brand Team')}</small></div></div>
    </div>
    <div class="dashboard-grid">
      <section class="dashboard-main">
        <div class="hero-panel">
          <div class="hero-copy">
            <h2>Welcome back, ${esc((currentUser?.name || 'Michael').split(' ')[0])}!</h2>
            <p>You have ${s.campaigns || 0} campaigns, ${s.queued || 0} queued sends, and ${s.contacts || 0} contacts ready.</p>
            <div class="hero-actions">
              <button id="dashNewCampaign">+ New Campaign</button>
              <button class="ai-btn" id="dashGenerate">✦ Generate with AI</button>
              <button class="ghost" id="dashSendTest">✈ Send Test</button>
            </div>
          </div>
          <div class="hero-art"><div class="envelope"><div></div></div><span class="star one">✦</span><span class="star two">✦</span></div>
        </div>
        ${s.dryRun ? `<div class="banner warn"><b>Dry-run mode is ON.</b> Test sends are logged only. Turn it off in Settings when SMTP is verified.</div>` : ''}
        <div class="metric-grid">
          ${metricCard('✈', 'Active Campaigns', s.campaigns || 0, '33% vs last 7 days', 'blue')}
          ${metricCard('✉', 'Emails Sent Today', s.sent || 0, '28% vs yesterday', 'purple')}
          ${metricCard('✓', 'Open Rate', `${s.sent ? Math.round((s.opens / s.sent) * 100) : 0}%`, '8.3% vs last 7 days', 'teal')}
          ${metricCard('↗', 'Click Rate', `${s.sent ? Math.round((s.clicks / s.sent) * 100) : 0}%`, '1.9% vs last 7 days', 'orange')}
        </div>
        <div class="panel chart-panel">
          <div class="panel-title"><h2>Campaign Performance</h2><span class="select-pill">Last 7 days⌄</span></div>
          <div class="line-chart">
            <svg viewBox="0 0 760 210" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="chartGlow" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#366cff" stop-opacity=".25"/><stop offset="100%" stop-color="#366cff" stop-opacity="0"/></linearGradient></defs>
              <path class="area blue" d="M0 146 L90 74 L180 48 L270 48 L380 22 L510 74 L640 56 L760 38 L760 210 L0 210 Z"/>
              <path class="line blue" d="M0 146 L90 74 L180 48 L270 48 L380 22 L510 74 L640 56 L760 38"/>
              <path class="line purple" d="M0 170 L90 125 L180 105 L270 98 L380 68 L510 116 L640 98 L760 76"/>
              <path class="line teal" d="M0 204 L90 178 L180 160 L270 154 L380 136 L510 172 L640 154 L760 138"/>
              <g class="grid-lines"><line x1="0" y1="42" x2="760" y2="42"/><line x1="0" y1="84" x2="760" y2="84"/><line x1="0" y1="126" x2="760" y2="126"/><line x1="0" y1="168" x2="760" y2="168"/></g>
            </svg>
          </div>
          <div class="chart-legend"><span class="blue">Emails Sent</span><span class="purple">Opens</span><span class="teal">Clicks</span></div>
        </div>
        <div class="panel table-panel">
          <div class="panel-title"><h2>✉ Recent Campaigns</h2><button class="ghost sm" id="viewCampaigns">View all campaigns</button></div>
          <table>
            <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Open Rate</th><th>Click Rate</th></tr></thead>
            <tbody>
              <tr><td><b>Product Launch</b><br><span class="muted">Promoting latest offer</span></td><td><span class="badge ok">Sent</span></td><td>${s.sent || 0}</td><td>${s.opens || 0}</td><td>${s.clicks || 0}</td></tr>
              <tr><td><b>Lead Follow-up</b><br><span class="muted">Queued recipient checks</span></td><td><span class="badge warn">${s.queued ? 'Scheduled' : 'Draft'}</span></td><td>${s.queued || '-'}</td><td>-</td><td>-</td></tr>
              <tr><td><b>Re-engagement</b><br><span class="muted">Templates ready to use</span></td><td><span class="badge warn">Draft</span></td><td>-</td><td>-</td><td>-</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <aside class="dashboard-rail">
        ${sidePanel('Automation Workflows', [
          ['Welcome Series', `${s.contacts || 0} contacts · ${s.opens || 0} opens`, 'Active'],
          ['Abandoned Cart', `${s.queued || 0} queued · ${s.clicks || 0} clicks`, 'Active'],
        ])}
        ${sidePanel('Audience Segments', [
          ['Active Subscribers', `${s.eligible || 0}`, ''],
          ['New Subscribers', `${s.contacts || 0}`, ''],
          ['Unsubscribed', `${s.unsubscribed || 0}`, ''],
        ])}
        <div class="panel quick-card">
          <h2>✈ Quick Test Email</h2>
          <p class="hint">Send a test email to preview your setup.</p>
          <div class="quick-input"><input id="dashQuickTo" placeholder="Enter email address..." /><span>✉</span></div>
          <button id="dashQuickSend" class="wide">Send Test Email</button>
          <p class="hint">Use commas to add multiple email addresses.</p>
        </div>
      </aside>
    </div>`;
  $('#dashNewCampaign').addEventListener('click', () => go('campaigns'));
  $('#dashGenerate').addEventListener('click', () => go('templates'));
  $('#dashSendTest').addEventListener('click', () => go('testEmail'));
  $('#viewCampaigns').addEventListener('click', () => go('campaigns'));
  $('#dashQuickSend').addEventListener('click', async () => {
    const to = $('#dashQuickTo').value.trim();
    if (!to) return toast('Enter an email address', 'err');
    try {
      const r = await api('/api/send-single', { method: 'POST', body: { to, subject: 'Test from Email Campaigner', html: '<p>Hello! This is a quick test email from Email Campaigner.</p>' } });
      toast(r.dryRun ? `DRY RUN - logged test for ${to}` : `Sent test to ${to}`);
    } catch (e) { toast(e.message, 'err'); }
  });
};
const spark = (tone = 'blue') => `<svg class="sparkline ${tone}" viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 32 L18 38 L34 29 L50 26 L68 17 L84 20 L102 14 L120 24 L136 12 L152 16 L160 10"/></svg>`;
const metricCard = (icon, label, n, delta, tone) => `
  <div class="metric-card ${tone}">
    <div class="metric-head"><span class="metric-icon">${icon}</span><span>${esc(label)}</span><button class="kebab">•••</button></div>
    <div class="metric-value">${esc(n)}</div>
    <div class="metric-delta">↑ ${esc(delta)}</div>
    ${spark(tone)}
  </div>`;
const sidePanel = (title, rows) => `
  <div class="panel side-panel">
    <div class="panel-title"><h2>${esc(title)}</h2><button class="ghost sm">View all</button></div>
    ${rows.map(([name, meta, state]) => `<div class="side-row"><span class="side-dot">⌘</span><div><b>${esc(name)}</b><small>${esc(meta)}</small></div>${state ? `<em>${esc(state)}</em>` : ''}<span class="chev">›</span></div>`).join('')}
  </div>`;
const card = (n, label) => `<div class="card"><div class="num">${n ?? 0}</div><div class="label">${label}</div></div>`;

// ── Contacts ─────────────────────────────────────────────
views.contacts = async () => {
  const vertical = routeParams.vertical || '';
  const vq = 'vertical=' + encodeURIComponent(vertical);
  const [{ contacts }, { tags }, vdata] = await Promise.all([
    api('/api/contacts?' + vq),
    api('/api/tags'),
    api('/api/verticals'),
  ]);
  const subtitle = vertical
    ? `${contacts.length} in <b>${esc(vertical)}</b> · imports & new contacts added here stay in this vertical.`
    : `${contacts.length} total${vdata.verticals.length ? ' · choose a vertical at left to work within one' : ''} · stored locally on this machine.`;
  main.innerHTML = `
    <h1>Contacts${vertical ? ` <span class="muted">/ ${esc(vertical)}</span>` : ''}</h1>
    <p class="subtitle">${subtitle}</p>
    <div class="toolbar">
      <input id="search" placeholder="Search name, email, company…" />
      <select id="tagFilter"><option value="">All tags</option>${tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button id="addBtn">+ Add contact</button>
      <button class="ghost" id="uploadBtn">⬆ Upload Excel/CSV</button>
      <button class="ghost" id="importBtn">Paste CSV</button>
      <button class="ghost" id="exportBtn">Export</button>
    </div>
    <div class="toolbar" id="bulkBar" style="display:none;margin-top:-6px">
      <span id="selCount" class="muted"></span>
      <div class="spacer"></div>
      <button class="danger" id="delSelBtn">🗑 Delete selected</button>
    </div>
    <div class="panel" style="padding:0"><table id="ctable">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="selAll" title="Select all on this page"></th>
        <th>Email</th><th>Name</th><th>Company</th><th>Tags</th><th>Status</th><th></th>
      </tr></thead>
      <tbody></tbody></table>
    </div>`;

  let shown = contacts; // rows currently displayed (after search/tag filtering)
  const draw = (rows) => {
    shown = rows;
    $('#ctable tbody').innerHTML = rows.length ? rows.map(contactRow).join('') :
      `<tr><td colspan="7" class="muted" style="padding:24px">No contacts ${vertical ? 'in this vertical' : 'yet'}. Add one or import a sheet.</td></tr>`;
    if (rows.length) bindRowActions();
    syncSelection();
  };
  draw(contacts);

  let filter = '';
  const apply = async () => {
    const q = $('#search').value.toLowerCase();
    const data = await api('/api/contacts?' + vq + (filter ? `&tag=${encodeURIComponent(filter)}` : ''));
    draw(data.contacts.filter((r) =>
      !q || [r.email, r.first_name, r.last_name, r.company].some((v) => (v || '').toLowerCase().includes(q))));
  };
  $('#search').addEventListener('input', apply);
  $('#tagFilter').addEventListener('change', (e) => { filter = e.target.value; apply(); });
  $('#addBtn').addEventListener('click', () => contactModal({ vertical }));
  $('#uploadBtn').addEventListener('click', () => uploadModal(vertical));
  $('#importBtn').addEventListener('click', () => importModal(vertical));
  $('#exportBtn').addEventListener('click', () => (window.location = '/api/contacts/export'));

  // ── selection + bulk delete ──
  const selectedIds = () => [...document.querySelectorAll('.rowpick:checked')].map((c) => +c.dataset.id);
  function syncSelection() {
    const boxes = [...document.querySelectorAll('.rowpick')];
    const n = boxes.filter((c) => c.checked).length;
    const bar = $('#bulkBar');
    if (bar) bar.style.display = n ? 'flex' : 'none';
    if ($('#selCount')) $('#selCount').innerHTML = `<b>${n}</b> selected${n === boxes.length && n ? ' (all)' : ''}`;
    const all = $('#selAll');
    if (all) { all.checked = boxes.length > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
  }
  $('#ctable').addEventListener('change', (e) => { if (e.target.classList.contains('rowpick')) syncSelection(); });
  $('#selAll').addEventListener('change', (e) => {
    document.querySelectorAll('.rowpick').forEach((c) => (c.checked = e.target.checked));
    syncSelection();
  });
  $('#delSelBtn').addEventListener('click', async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const scope = vertical ? ` from “${vertical}”` : '';
    if (!confirm(`Delete ${ids.length} contact${ids.length > 1 ? 's' : ''}${scope}? This can't be undone.`)) return;
    const btn = $('#delSelBtn'); btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      const r = await api('/api/contacts/bulk-delete', { method: 'POST', body: { ids } });
      toast(`Deleted ${r.deleted} contact${r.deleted === 1 ? '' : 's'}`);
      renderVerticalNav(); render();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '🗑 Delete selected'; }
  });

  function bindRowActions() {
    document.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => contactModal(shown.find((c) => c.id == b.dataset.edit))));
    document.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this contact?')) return;
        await api(`/api/contacts/${b.dataset.del}`, { method: 'DELETE' });
        toast('Contact deleted'); renderVerticalNav(); render();
      }));
  }
};

function contactRow(c) {
  const tags = (c.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag">${esc(t.trim())}</span>`).join('');
  const status = c.unsubscribed ? '<span class="badge bad">unsub</span>'
    : c.consent ? '<span class="badge ok">opt-in</span>' : '<span class="badge warn">no consent</span>';
  return `<tr>
    <td><input type="checkbox" class="rowpick" data-id="${c.id}"></td>
    <td>${esc(c.email)}</td>
    <td>${esc([c.first_name, c.last_name].filter(Boolean).join(' ')) || '<span class="muted">—</span>'}</td>
    <td>${esc(c.company) || '<span class="muted">—</span>'}</td>
    <td>${tags || '<span class="muted">—</span>'}</td>
    <td>${status}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="ghost sm" data-edit="${c.id}">Edit</button>
      <button class="danger sm" data-del="${c.id}">✕</button>
    </td></tr>`;
}

function contactModal(c = {}) {
  const isEdit = !!c.id;
  modal(`
    <h2>${isEdit ? 'Edit' : 'Add'} contact</h2>
    <div class="field"><label>Email *</label><input id="m_email" value="${esc(c.email || '')}" /></div>
    <div class="row">
      <div class="field"><label>First name</label><input id="m_first" value="${esc(c.first_name || '')}" /></div>
      <div class="field"><label>Last name</label><input id="m_last" value="${esc(c.last_name || '')}" /></div>
    </div>
    <div class="field"><label>Company</label><input id="m_company" value="${esc(c.company || '')}" /></div>
    <div class="row">
      <div class="field"><label>Vertical</label><input id="m_vertical" value="${esc(c.vertical || '')}" placeholder="e.g. Medical" /></div>
      <div class="field"><label>Tags (comma separated)</label><input id="m_tags" value="${esc(c.tags || '')}" /></div>
    </div>
    <div class="field checkrow"><input type="checkbox" id="m_consent" ${c.consent ? 'checked' : ''} /><label style="margin:0">Has explicitly opted in (consent on record)</label></div>
    ${isEdit ? `<div class="field checkrow"><input type="checkbox" id="m_unsub" ${c.unsubscribed ? 'checked' : ''} /><label style="margin:0">Unsubscribed</label></div>` : ''}
    <div class="row" style="margin-top:12px"><button id="m_save">Save</button><button class="ghost" onclick="this.closest('.modal-backdrop').classList.add('hidden')">Cancel</button></div>
  `);
  $('#m_save').addEventListener('click', async () => {
    const body = {
      email: $('#m_email').value.trim(),
      first_name: $('#m_first').value.trim(),
      last_name: $('#m_last').value.trim(),
      company: $('#m_company').value.trim(),
      vertical: $('#m_vertical').value.trim(),
      tags: $('#m_tags').value.trim(),
      consent: $('#m_consent').checked ? 1 : 0,
    };
    if (isEdit) body.unsubscribed = $('#m_unsub')?.checked ? 1 : 0;
    if (!body.email) return toast('Email required', 'err');
    try {
      await api(isEdit ? `/api/contacts/${c.id}` : '/api/contacts', { method: isEdit ? 'PUT' : 'POST', body });
      closeModal(); toast('Saved'); renderVerticalNav(); render();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function uploadModal(vertical = '') {
  modal(`
    <h2>Upload data sheet</h2>
    <p class="hint">Upload an <b>Excel (.xlsx/.xls)</b> or <b>.csv</b> file. Row 1 must be headers. Tuned for the <b>Apollo medical list</b> export — expected columns:<br>
    <code>First Name, Last Name, Job Title, Company Name, Email, City, State, Email #1, Email #2, Email #3</code>.<br>
    <span class="muted">Only an email is required (the <code>Email</code> column, falling back to <code>Email #1/#2/#3</code>). Job Title, City &amp; State import as merge fields <code>{{jobTitle}}</code>, <code>{{city}}</code>, <code>{{state}}</code>.</span></p>
    <div class="field"><label>File</label><input type="file" id="upfile" accept=".xlsx,.xls,.xlsm,.csv" /></div>
    <div class="row">
      <div class="field"><label>Vertical <span class="muted">(keeps this list separate)</span></label><input id="upvert" value="${esc(vertical)}" placeholder="e.g. Medical" /></div>
      <div class="field"><label>Apply tags to all imported</label><input id="uptags" placeholder="leads,2026" /></div>
    </div>
    <div class="row"><button id="doUpload">Upload</button><button class="ghost" onclick="this.closest('.modal-backdrop').classList.add('hidden')">Cancel</button></div>
  `);
  $('#doUpload').addEventListener('click', async () => {
    const file = $('#upfile').files[0];
    if (!file) return toast('Choose a file first', 'err');
    const btn = $('#doUpload'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const fd = new FormData();
      fd.append('tags', $('#uptags').value.trim());
      fd.append('vertical', $('#upvert').value.trim());
      fd.append('file', file);
      const res = await fetch('/api/contacts/upload', { method: 'POST', body: fd });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `Upload failed (${res.status})`);
      closeModal();
      toast(`Imported ${esc(r.filename || 'file')}: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped`);
      const vert = $('#upvert') ? $('#upvert').value.trim() : '';
      renderVerticalNav();
      vert && vert !== (routeParams.vertical || '') ? go('contacts', { vertical: vert }) : render();
    } catch (e) {
      toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Upload';
    }
  });
}

function importModal(vertical = '') {
  modal(`
    <h2>Import contacts (paste CSV)</h2>
    <p class="hint">First row = headers. Apollo medical-list columns are recognized: <code>First Name, Last Name, Job Title, Company Name, Email, City, State, Email #1/#2/#3</code> (generic <code>email, first_name, last_name, company, tags, consent</code> also work). Only an email is required.</p>
    <div class="field"><label>Paste CSV</label><textarea id="csv" style="min-height:160px" placeholder="email,first_name,company&#10;jane@acme.com,Jane,Acme Inc"></textarea></div>
    <div class="row">
      <div class="field"><label>Vertical <span class="muted">(keeps this list separate)</span></label><input id="impvert" value="${esc(vertical)}" placeholder="e.g. Medical" /></div>
      <div class="field"><label>Apply tags to all imported</label><input id="imptags" placeholder="newsletter,2026" /></div>
    </div>
    <div class="row"><button id="doImport">Import</button><button class="ghost" onclick="this.closest('.modal-backdrop').classList.add('hidden')">Cancel</button></div>
  `);
  $('#doImport').addEventListener('click', async () => {
    const vert = $('#impvert').value.trim();
    try {
      const r = await api('/api/contacts/import', { method: 'POST', body: { csv: $('#csv').value, tags: $('#imptags').value.trim(), vertical: vert } });
      closeModal(); toast(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped`);
      renderVerticalNav();
      vert && vert !== (routeParams.vertical || '') ? go('contacts', { vertical: vert }) : render();
    } catch (e) { toast(e.message, 'err'); }
  });
}

// Send one email right now (testing / ad-hoc). Optionally prefilled.
function sendTestModal(prefill = {}) {
  modal(`
    <h2>Send a single email</h2>
    <p class="hint">Sends one email immediately — bypasses campaigns & the queue. Respects <b>DRY RUN</b>: in dry-run nothing actually leaves, it's just logged so you can test the flow.</p>
    <div class="field"><label>To</label><input id="st_to" placeholder="you@example.com" value="${esc(prefill.to || '')}" /></div>
    <div class="field"><label>Subject</label><input id="st_subj" value="${esc(prefill.subject || 'Test from Email Campaigner')}" /></div>
    <div class="field"><label>Body (HTML)</label><textarea id="st_body" style="min-height:140px">${esc(prefill.html || '<p>Hello! This is a test email from Email Campaigner.</p>')}</textarea></div>
    <div class="row"><button id="st_send">Send now</button><button class="ghost" onclick="this.closest('.modal-backdrop').classList.add('hidden')">Cancel</button></div>
  `);
  $('#st_send').addEventListener('click', async () => {
    const to = $('#st_to').value.trim();
    if (!to) return toast('Enter a To address', 'err');
    const btn = $('#st_send'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await api('/api/send-single', { method: 'POST', body: { to, subject: $('#st_subj').value, html: $('#st_body').value } });
      closeModal();
      toast(r.dryRun ? `DRY RUN — logged (would send to ${to})` : `Sent to ${to} ✓`);
    } catch (e) {
      toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Send now';
    }
  });
}

// ── Find Leads (scraper) ─────────────────────────────────
views.scrape = async () => {
  main.innerHTML = `
    <h1>Find Leads</h1>
    <p class="subtitle">Discover public contact addresses from business pages (contact / team / about pages).</p>
    <div class="banner">⚖️ Use responsibly: scrape only publicly listed business addresses you have a legitimate reason to contact, honor opt-outs, and follow CAN-SPAM / GDPR. Scraped contacts are saved <b>without consent</b> and flagged for review before any send.</div>
    <div class="panel">
      <div class="field"><label>URLs to scan (one per line, up to 25)</label>
        <textarea id="urls" placeholder="https://example.com/contact&#10;https://acme.com/team"></textarea></div>
      <button id="scanBtn">🔎 Scan</button>
    </div>
    <div id="scrapeResults"></div>`;
  $('#scanBtn').addEventListener('click', async () => {
    const urls = $('#urls').value.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return toast('Enter at least one URL', 'err');
    $('#scrapeResults').innerHTML = '<div class="loading">Scanning…</div>';
    try {
      const r = await api('/api/scrape/preview', { method: 'POST', body: { urls } });
      renderScrapeResults(r);
    } catch (e) { $('#scrapeResults').innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
  });
};

function renderScrapeResults(r) {
  if (!r.contacts.length) {
    $('#scrapeResults').innerHTML = `<div class="panel muted">No addresses found. ${r.results.some((x) => x.blockedByRobots) ? 'Some pages blocked by robots.txt.' : ''}</div>`;
    return;
  }
  $('#scrapeResults').innerHTML = `
    <div class="panel" style="padding:0">
      <div style="padding:14px 18px;display:flex;align-items:center">
        <b>${r.contacts.length} contacts found</b><div class="spacer"></div>
        <input id="scrapeTags" placeholder="tag (e.g. leads-2026)" style="width:200px;margin-right:10px" value="scraped" />
        <button id="saveScraped">Save selected</button>
      </div>
      <table><thead><tr><th><input type="checkbox" id="checkAll" checked></th><th>Email</th><th>Name</th><th>Company</th><th>Source</th></tr></thead>
      <tbody>${r.contacts.map((c, i) => `<tr>
        <td><input type="checkbox" class="pick" data-i="${i}" checked></td>
        <td>${esc(c.email)}</td>
        <td>${esc([c.first_name, c.last_name].filter(Boolean).join(' ')) || '<span class="muted">—</span>'}</td>
        <td>${esc(c.company || '')}</td>
        <td class="muted" style="font-size:11px">${esc((c.sourceUrl || '').replace(/^https?:\/\//, '').slice(0, 40))}</td>
      </tr>`).join('')}</tbody></table>
    </div>`;
  $('#checkAll').addEventListener('change', (e) => document.querySelectorAll('.pick').forEach((c) => (c.checked = e.target.checked)));
  $('#saveScraped').addEventListener('click', async () => {
    const picked = [...document.querySelectorAll('.pick:checked')].map((c) => r.contacts[+c.dataset.i]);
    if (!picked.length) return toast('Select at least one', 'err');
    const res = await api('/api/scrape/save', { method: 'POST', body: { contacts: picked, tags: $('#scrapeTags').value.trim() || 'scraped' } });
    toast(`Saved ${res.saved} contacts to your list`); go('contacts');
  });
}

views.testEmail = async () => {
  const health = await api('/api/health').catch(() => ({ dryRun: true }));
  main.innerHTML = `
    <h1>Test Email</h1>
    <p class="subtitle">Send one message without creating contacts, templates, or campaigns.</p>
    <div class="banner ${health.dryRun ? 'warn' : ''}">
      ${health.dryRun
        ? '<b>Dry-run mode is ON.</b> This will log the test only; no email will actually leave the app.'
        : '<b>Live sending is ON.</b> This will send one real email through the configured SMTP account.'}
    </div>
    <div class="panel">
      <h2>Single test send</h2>
      <div class="field"><label>To</label><input id="test_to" placeholder="you@example.com" autocomplete="email" /></div>
      <div class="field"><label>Subject</label><input id="test_subject" value="Test from Email Campaigner" /></div>
      <div class="field"><label>Body (HTML)</label><textarea id="test_body" style="min-height:180px"><p>Hello! This is a test email from Email Campaigner.</p></textarea></div>
      <div class="row" style="align-items:center">
        <button id="test_send">Send test</button>
        <button class="ghost" id="test_fill">Reset sample</button>
      </div>
      <p class="hint">Use this to verify login, SMTP settings, and basic delivery before touching campaign workflows.</p>
    </div>
    <div class="panel" id="test_result" style="display:none"></div>`;

  $('#test_fill').addEventListener('click', () => {
    $('#test_subject').value = 'Test from Email Campaigner';
    $('#test_body').value = '<p>Hello! This is a test email from Email Campaigner.</p>';
  });

  $('#test_send').addEventListener('click', async () => {
    const to = $('#test_to').value.trim();
    if (!to || !to.includes('@')) return toast('Enter a valid recipient email', 'err');
    const btn = $('#test_send');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const r = await api('/api/send-single', {
        method: 'POST',
        body: { to, subject: $('#test_subject').value, html: $('#test_body').value },
      });
      $('#test_result').style.display = 'block';
      $('#test_result').innerHTML = `
        <h2>${r.dryRun ? 'Dry-run logged' : 'Email sent'}</h2>
        <table>
          <tr><td>Recipient</td><td>${esc(r.to)}</td></tr>
          <tr><td>Mode</td><td>${r.dryRun ? '<span class="badge warn">DRY RUN</span>' : '<span class="badge ok">LIVE</span>'}</td></tr>
          <tr><td>Message ID</td><td>${r.messageId ? esc(r.messageId) : '<span class="muted">not available</span>'}</td></tr>
        </table>`;
      toast(r.dryRun ? `DRY RUN - logged test for ${to}` : `Sent test to ${to}`);
    } catch (e) {
      toast(e.message, 'err');
      $('#test_result').style.display = 'block';
      $('#test_result').innerHTML = `<h2>Send failed</h2><div class="banner warn">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send test';
    }
  });
};

// ── Templates (with AI compose) ──────────────────────────
views.templates = async () => {
  const { templates } = await api('/api/templates');
  main.innerHTML = `
    <h1>Templates</h1>
    <p class="subtitle">Reusable emails with {{firstName}}, {{company}} merge fields.</p>
    <div class="toolbar"><button id="newTpl">+ New template</button><div class="spacer"></div></div>
    <div class="panel" style="padding:0"><table>
      <thead><tr><th>Name</th><th>Subject</th><th>Updated</th><th></th></tr></thead>
      <tbody>${templates.length ? templates.map((t) => `<tr>
        <td><b>${esc(t.name)}</b></td><td>${esc(t.subject) || '<span class="muted">—</span>'}</td>
        <td class="muted">${esc((t.updated_at || '').slice(0, 16))}</td>
        <td style="text-align:right"><button class="ghost sm" data-edit="${t.id}">Edit</button> <button class="danger sm" data-del="${t.id}">✕</button></td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted" style="padding:24px">No templates yet.</td></tr>'}</tbody>
    </table></div>`;
  $('#newTpl').addEventListener('click', () => templateEditor());
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => templateEditor(templates.find((t) => t.id == b.dataset.edit))));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete template?')) return;
    await api(`/api/templates/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); render();
  }));
};

function templateEditor(t = {}) {
  const isEdit = !!t.id;
  main.innerHTML = `
    <h1>${isEdit ? 'Edit' : 'New'} template</h1>
    <p class="subtitle"><a class="muted" id="back" style="cursor:pointer">← Back to templates</a></p>
    <div class="split">
      <div>
        <div class="panel">
          <div class="field"><label>Template name</label><input id="t_name" value="${esc(t.name || '')}" placeholder="Spring outreach" /></div>
          <div class="field"><label>Subject</label><input id="t_subject" value="${esc(t.subject || '')}" placeholder="Quick idea for {{company}}" /></div>
          <div class="field"><label>Body (HTML, supports {{firstName}} {{company}} {{senderName}})</label>
            <textarea id="t_body" style="min-height:240px">${esc(t.body || '')}</textarea></div>
          <button id="t_save">Save template</button>
          <button class="ghost" id="t_preview">Preview</button>
          <button class="ghost" id="t_test">✉ Send test</button>
        </div>
      </div>
      <div>
        <div class="panel" style="border-color:var(--accent)">
          <h2>✨ AI compose</h2>
          <div class="field"><label>What should this email do?</label>
            <textarea id="ai_prompt" placeholder="Introduce our promotional products agency to marketing managers at mid-size companies. Mention fast turnaround and free samples."></textarea></div>
          <div class="row">
            <div class="field"><label>Tone</label><select id="ai_tone"><option>friendly</option><option>professional</option><option>casual</option><option>enthusiastic</option><option>concise</option></select></div>
            <div class="field"><label>Goal / CTA</label><input id="ai_goal" placeholder="book a 15-min call" /></div>
          </div>
          <button id="ai_go">✨ Generate</button>
          <p class="hint">Generates a subject + body, then fills the fields on the left. Review & edit before saving.</p>
        </div>
        <div class="panel" id="previewPanel" style="display:none">
          <h2>Preview</h2><div class="preview-box" id="previewBox"></div>
        </div>
      </div>
    </div>`;
  $('#back').addEventListener('click', () => go('templates'));
  $('#t_save').addEventListener('click', async () => {
    const body = { name: $('#t_name').value.trim(), subject: $('#t_subject').value, body: $('#t_body').value };
    if (!body.name) return toast('Name required', 'err');
    try {
      await api(isEdit ? `/api/templates/${t.id}` : '/api/templates', { method: isEdit ? 'PUT' : 'POST', body });
      toast('Template saved'); go('templates');
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#t_preview').addEventListener('click', () => {
    $('#previewPanel').style.display = 'block';
    $('#previewBox').innerHTML = `<div class="subj">${esc($('#t_subject').value || '(no subject)')}</div>${$('#t_body').value}`;
  });
  $('#t_test').addEventListener('click', () => sendTestModal({ subject: $('#t_subject').value, html: $('#t_body').value }));
  $('#ai_go').addEventListener('click', async () => {
    const prompt = $('#ai_prompt').value.trim();
    if (!prompt) return toast('Describe the email first', 'err');
    const btn = $('#ai_go'); btn.disabled = true; btn.textContent = '✨ Generating…';
    try {
      const r = await api('/api/ai/generate', { method: 'POST', body: { prompt, tone: $('#ai_tone').value, goal: $('#ai_goal').value } });
      $('#t_subject').value = r.subject || $('#t_subject').value;
      $('#t_body').value = r.body || $('#t_body').value;
      toast('Draft generated — review it');
    } catch (e) { toast('AI error: ' + e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = '✨ Generate'; }
  });
}

// ── Campaigns ────────────────────────────────────────────
views.campaigns = async () => {
  const { campaigns } = await api('/api/campaigns');
  const { templates } = await api('/api/templates');
  const { tags } = await api('/api/tags');
  main.innerHTML = `
    <h1>Campaigns</h1>
    <p class="subtitle">Pick a template + audience, preview, then launch.</p>
    <div class="panel">
      <h2>New campaign</h2>
      <div class="row">
        <div class="field"><label>Name</label><input id="c_name" placeholder="June outreach" /></div>
        <div class="field"><label>Audience</label><select id="c_tag"><option value="">All eligible contacts</option>${tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Initial email *</label><select id="c_tpl">${tplOptions(templates)}</select></div>
        <div class="field"><label>Follow-up 1 <span class="muted">(optional)</span></label><select id="c_f1"><option value="">— none —</option>${tplOptions(templates)}</select></div>
        <div class="field"><label>Follow-up 2 <span class="muted">(optional)</span></label><select id="c_f2"><option value="">— none —</option>${tplOptions(templates)}</select></div>
        <div class="field" style="max-width:130px"><label>Gap (business days)</label><input id="c_gap" type="number" min="1" value="3" /></div>
      </div>
      <p class="hint">Follow-ups go only to contacts who haven't unsubscribed, spaced the gap above apart (skipping weekends). Each send is paced ~${esc(String(window.__spacing ?? 45))}s apart to protect deliverability.</p>
      <button id="c_create">Create campaign</button>
    </div>
    <div class="panel" style="padding:0"><table>
      <thead><tr><th>Name</th><th>Status</th><th>Audience</th><th>Result</th><th></th></tr></thead>
      <tbody>${campaigns.length ? campaigns.map(campaignRow).join('') : '<tr><td colspan="5" class="muted" style="padding:24px">No campaigns yet.</td></tr>'}</tbody>
    </table></div>`;
  $('#c_create').addEventListener('click', async () => {
    const name = $('#c_name').value.trim(), template_id = $('#c_tpl').value;
    if (!name || !template_id) return toast('Name and initial template required', 'err');
    await api('/api/campaigns', { method: 'POST', body: {
      name, template_id, audience_tag: $('#c_tag').value,
      followup1_template_id: $('#c_f1').value || null,
      followup2_template_id: $('#c_f2').value || null,
      gap_days: +$('#c_gap').value || 3,
    } });
    toast('Campaign created'); render();
  });
  document.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => go('tracking', { campaignId: b.dataset.track })));
  document.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => previewCampaign(b.dataset.prev)));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete campaign?')) return;
    await api(`/api/campaigns/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); render();
  }));
};

const tplOptions = (templates) =>
  templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('') ||
  '<option value="">— create a template first —</option>';

function campaignRow(c) {
  const stats = JSON.parse(c.stats || '{}');
  const badge = { draft: 'warn', queued: 'warn', running: 'warn', done: 'ok', failed: 'bad' }[c.status] || 'warn';
  const result = stats.total != null
    ? `${stats.sent || 0} sent · ${stats.pending || 0} queued · ${stats.opens || 0} opened · ${stats.failed || 0} failed`
    : '<span class="muted">—</span>';
  return `<tr>
    <td><b>${esc(c.name)}</b></td>
    <td><span class="badge ${badge}">${c.status}</span></td>
    <td>${c.audience_tag ? `<span class="tag">${esc(c.audience_tag)}</span>` : '<span class="muted">all</span>'}</td>
    <td>${result}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="ghost sm" data-prev="${c.id}">Preview & send</button>
      <button class="ghost sm" data-track="${c.id}">Tracking</button>
      <button class="danger sm" data-del="${c.id}">✕</button>
    </td></tr>`;
}

async function previewCampaign(id) {
  const p = await api(`/api/campaigns/${id}/preview`);
  const fmt = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const schedule = (p.schedule || []).map((s) =>
    `<tr><td><b>${esc(s.label)}</b></td><td>${esc(s.template)}</td><td class="muted">${esc(fmt(s.when))}</td></tr>`).join('');
  modal(`
    <h2>Preview & send</h2>
    <div class="banner ${p.dryRun ? 'warn' : ''}">${p.dryRun ? '🟡 DRY RUN — nothing will actually be sent.' : '🟢 LIVE — real emails will be sent.'} Audience: <b>${p.audienceSize}</b> contacts · ~${p.spacingSeconds}s between sends.</div>
    <h3 style="margin:8px 0 4px">Drip schedule</h3>
    <table style="margin-bottom:12px"><thead><tr><th>Step</th><th>Template</th><th>First send ≈</th></tr></thead><tbody>${schedule || '<tr><td colspan="3" class="muted">No steps.</td></tr>'}</tbody></table>
    ${p.preview ? `<div class="preview-box"><div class="subj">${esc(p.preview.subject)}</div>${p.preview.body}</div>` : '<div class="muted">No template/audience.</div>'}
    <div class="row" style="margin-top:16px">
      <button id="launch" ${p.audienceSize ? '' : 'disabled'}>${p.dryRun ? 'Queue dry-run' : `Queue send to ${p.audienceSize}`}</button>
      <button class="ghost" onclick="this.closest('.modal-backdrop').classList.add('hidden')">Close</button>
    </div>`);
  $('#launch').addEventListener('click', async () => {
    try {
      const r = await api(`/api/campaigns/${id}/send`, { method: 'POST' });
      closeModal(); toast(`Queued ${r.queued} sends across ${r.steps} step(s)`); pollCampaign(id);
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function pollCampaign(id) {
  for (let i = 0; i < 120; i++) {
    const { campaign } = await api(`/api/campaigns/${id}/events`);
    if (current === 'campaigns') render();
    if (!campaign || campaign.status === 'done' || campaign.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ── Tracking ─────────────────────────────────────────────
views.tracking = async () => {
  const { campaigns } = await api('/api/campaigns');
  const id = routeParams.campaignId || campaigns[0]?.id;
  if (!campaigns.length) {
    main.innerHTML = `<h1>Tracking</h1><div class="panel muted">No campaigns yet. Create one under 🚀 Campaigns.</div>`;
    return;
  }
  main.innerHTML = `
    <h1>Tracking</h1>
    <p class="subtitle">Opens & clicks per recipient. <a class="muted" id="trkInfo" style="cursor:pointer">What about spam / deleted? ▾</a></p>
    <div id="trkInfoBox" class="banner" style="display:none">
      <b>What email tracking can and can't see.</b>
      <ul style="margin:8px 0 0 18px;line-height:1.6">
        <li>✅ <b>Opened</b> (invisible pixel loaded) and <b>clicked</b> (links routed through us) are tracked here. Note: some clients (e.g. Apple Mail Privacy, Gmail image proxy) pre-load or block the pixel, so opens are <i>directional, not exact</i>.</li>
        <li>✅ <b>Bounced / unsubscribed</b> are tracked (bounces require a Make.com bounce hook — see docs/TRACKING.md).</li>
        <li>❌ <b>Went to spam</b> and <b>deleted unread</b> are <u>not</u> observable from a sending app — no mail provider exposes that to senders. The real way to monitor inbox-vs-spam placement is <b>Google Postmaster Tools</b> (domain reputation) plus <b>seed-list / inbox-placement testing</b> (e.g. GlockApps, MailReach). Setup steps are in <code>docs/TRACKING.md</code>.</li>
      </ul>
    </div>
    <div class="toolbar">
      <select id="trkPick">${campaigns.map((c) => `<option value="${c.id}" ${c.id == id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="ghost" id="trkRefresh">↻ Refresh</button>
    </div>
    <div id="trkBody"><div class="loading">Loading…</div></div>`;

  $('#trkInfo').addEventListener('click', () => {
    const b = $('#trkInfoBox'); b.style.display = b.style.display === 'none' ? 'block' : 'none';
  });
  $('#trkPick').addEventListener('change', (e) => { routeParams.campaignId = e.target.value; drawTracking(e.target.value); });
  $('#trkRefresh').addEventListener('click', () => drawTracking($('#trkPick').value));
  drawTracking(id);
};

async function drawTracking(id) {
  const box = $('#trkBody');
  if (!box) return;
  const { stats, recipients } = await api(`/api/campaigns/${id}/tracking`);
  const openRate = stats.sent ? Math.round((stats.opens / stats.sent) * 100) : 0;
  const clickRate = stats.sent ? Math.round((stats.clicks / stats.sent) * 100) : 0;
  const statusBadge = (s) => {
    const m = { clicked: 'ok', opened: 'ok', sent: 'warn', pending: 'warn', failed: 'bad', unsubscribed: 'bad' };
    return `<span class="badge ${m[s] || 'warn'}">${s}</span>`;
  };
  box.innerHTML = `
    <div class="cards">
      ${card(stats.sent || 0, 'Sent')}
      ${card(stats.pending || 0, 'Queued')}
      ${card(`${stats.opens || 0} · ${openRate}%`, 'Opened')}
      ${card(`${stats.clicks || 0} · ${clickRate}%`, 'Clicked')}
      ${card(stats.failed || 0, 'Failed')}
    </div>
    <div class="panel" style="padding:0"><table>
      <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Opens</th><th>Clicks</th><th>Last open</th></tr></thead>
      <tbody>${recipients.length ? recipients.map((r) => `<tr>
        <td>${esc(r.email)}</td>
        <td>${esc([r.first_name, r.last_name].filter(Boolean).join(' ')) || '<span class="muted">—</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.opens || 0}</td>
        <td>${r.clicks || 0}</td>
        <td class="muted">${r.last_open ? esc(new Date(r.last_open).toLocaleString()) : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted" style="padding:24px">No sends queued yet for this campaign.</td></tr>'}</tbody>
    </table></div>`;
}

// ── Settings ─────────────────────────────────────────────
views.settings = async () => {
  if (!currentUser) await loadUser();
  const s = await api('/api/settings');
  main.innerHTML = `
    <h1>Settings</h1>
    <p class="subtitle">Sender identity, SMTP, AI, sending safety, and Make.com.</p>
    <div class="panel">
      <h2>Sending safety</h2>
      <div class="row">
        <div class="field checkrow"><input type="checkbox" id="s_dry" ${s.dryRun ? 'checked' : ''}><label style="margin:0">Dry run (don't actually send — recommended until tested)</label></div>
        <div class="field"><label>Spacing between sends (seconds)</label><input id="s_space" type="number" min="0" value="${s.sendSpacingSeconds ?? 45}" /></div>
        <div class="field"><label>+ random jitter up to (seconds)</label><input id="s_jit" type="number" min="0" value="${s.sendJitterSeconds ?? 15}" /></div>
      </div>
      <p class="hint">The worker sends at most one email per spacing interval (plus a little random jitter) so a blast looks human-paced. Dry-run sends are paced fast (~1s) for testing.</p>
    </div>
    <div class="panel">
      <h2>Sender identity</h2>
      <div class="row">
        <div class="field"><label>From name</label><input id="s_sname" value="${esc(s.sender.name)}" /></div>
        <div class="field"><label>From email</label><input id="s_semail" value="${esc(s.sender.email)}" /></div>
      </div>
      <div class="field"><label>Physical mailing address (required in footer by CAN-SPAM)</label><input id="s_saddr" value="${esc(s.sender.address || '')}" /></div>
    </div>
    <div class="panel">
      <h2>SMTP (outbound mail)</h2>
      <div class="row">
        <div class="field"><label>Host</label><input id="s_host" value="${esc(s.smtp.host)}" placeholder="smtp.gmail.com" /></div>
        <div class="field"><label>Port</label><input id="s_port" type="number" value="${s.smtp.port}" /></div>
        <div class="field checkrow"><input type="checkbox" id="s_secure" ${s.smtp.secure ? 'checked' : ''}><label style="margin:0">SSL (465)</label></div>
      </div>
      <div class="row">
        <div class="field"><label>Username</label><input id="s_user" value="${esc(s.smtp.user)}" /></div>
        <div class="field"><label>Password</label><input id="s_pass" type="password" value="${esc(s.smtp.pass)}" placeholder="••••••" /></div>
      </div>
      <button class="ghost" id="s_testsmtp">Test connection</button>
      <button class="ghost" id="s_sendtest">✉ Send test email</button>
    </div>
    <div class="panel">
      <h2>AI</h2>
      <div class="row">
        <div class="field"><label>Provider</label><select id="s_aiprov"><option value="ollama" ${s.ai.provider === 'ollama' ? 'selected' : ''}>Ollama (local, free)</option><option value="claude" ${s.ai.provider === 'claude' ? 'selected' : ''}>Claude API</option></select></div>
        <div class="field"><label>Ollama model</label><input id="s_ollmodel" value="${esc(s.ai.ollamaModel)}" /></div>
      </div>
      <div class="field"><label>Anthropic API key (only for Claude)</label><input id="s_aikey" type="password" value="${esc(s.ai.anthropicKey)}" placeholder="••••••" /></div>
    </div>
    <div class="panel">
      <h2>Make.com</h2>
      <div class="field"><label>Outbound webhook URL (we POST send/campaign events here)</label><input id="s_makeurl" value="${esc(s.make.webhookUrl)}" placeholder="https://hook.make.com/..." /></div>
      <div class="field"><label>Inbound secret (header x-make-secret to trigger campaigns)</label><input id="s_makesec" value="${esc(s.make.inboundSecret)}" /></div>
      <p class="hint">See <code>docs/MAKE_INTEGRATION.md</code> for scenario setup.</p>
    </div>
    ${currentUser && currentUser.role === 'admin' ? `
    <div class="panel">
      <h2>Users</h2>
      ${authDisabled
        ? '<p class="hint">Login is disabled (local mode). When you deploy the hosted version with auth enabled, you can add teammates here.</p>'
        : `<div id="userList" class="muted">Loading…</div>
           <div class="row" style="margin-top:14px;align-items:flex-end">
             <div class="field"><label>Email</label><input id="u_email" placeholder="teammate@company.com" /></div>
             <div class="field"><label>Name</label><input id="u_name" /></div>
             <div class="field"><label>Password</label><input id="u_pass" type="password" placeholder="min 8 chars" /></div>
             <div class="field" style="max-width:130px"><label>Role</label><select id="u_role"><option value="user">User</option><option value="admin">Admin</option></select></div>
             <div style="flex:0"><button id="u_add">Add user</button></div>
           </div>`}
    </div>` : ''}
    <button id="s_save">Save all settings</button>`;

  if (currentUser && currentUser.role === 'admin' && !authDisabled) renderUsers();

  $('#s_testsmtp').addEventListener('click', async () => {
    const r = await api('/api/settings/test-smtp', { method: 'POST' });
    toast(r.ok ? `SMTP OK (${r.host})` : `SMTP failed: ${r.error}`, r.ok ? 'ok' : 'err');
  });
  $('#s_sendtest').addEventListener('click', () => sendTestModal());
  $('#s_save').addEventListener('click', async () => {
    const body = {
      dryRun: $('#s_dry').checked,
      sendSpacingSeconds: +$('#s_space').value, sendJitterSeconds: +$('#s_jit').value,
      sender: { name: $('#s_sname').value, email: $('#s_semail').value, address: $('#s_saddr').value },
      smtp: { host: $('#s_host').value, port: +$('#s_port').value, secure: $('#s_secure').checked, user: $('#s_user').value, pass: $('#s_pass').value },
      ai: { provider: $('#s_aiprov').value, ollamaModel: $('#s_ollmodel').value, anthropicKey: $('#s_aikey').value },
      make: { webhookUrl: $('#s_makeurl').value, inboundSecret: $('#s_makesec').value },
    };
    await api('/api/settings', { method: 'PUT', body });
    toast('Settings saved'); refreshMode();
  });
};

// ── boot ─────────────────────────────────────────────────
loadUser();
refreshMode();
renderVerticalNav();
render();
