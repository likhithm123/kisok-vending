'use strict';
/* CampusVend admin portal — plain JavaScript, no build step. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const when = (ms) => ms ? new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
let me = null, timer = null;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Please log in'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const get = (u) => api('GET', u), post = (u, b = {}) => api('POST', u, b), put = (u, b) => api('PUT', u, b);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- modal ----------
function modal(title, bodyHtml, onSubmit, submitLabel = 'Save') {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${bodyHtml}<p class="error"></p>
    <div class="row" style="justify-content:flex-end"><button type="button" value="cancel" id="dlgCancel">Close</button>${onSubmit ? `<button class="primary" id="dlgOk">${esc(submitLabel)}</button>` : ''}</div></form>`;
  $('#dlgCancel', d).onclick = () => d.close();
  $('form', d).onsubmit = async (ev) => {
    ev.preventDefault(); if (!onSubmit) return d.close();
    const f = Object.fromEntries(new FormData(ev.target));
    for (const c of ev.target.querySelectorAll('input[type=checkbox]')) f[c.name] = c.checked;
    try { if ((await onSubmit(f)) !== false) d.close(); } catch (e) { $('.error', d).textContent = e.message; }
  };
  d.showModal();
  return d;
}

// ---------- charts (single series, one hue; values shown on hover and in tables) ----------
function tipOn(el) {
  const tip = $('#tip');
  el.addEventListener('mousemove', (ev) => {
    const t = ev.target.closest('[data-tip]'); if (!t) return (tip.hidden = true);
    tip.textContent = t.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = ev.clientY - 34 + 'px';
  });
  el.addEventListener('mouseleave', () => (tip.hidden = true));
}
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v); }
function barChart(data, fmt = inr, every = 1) {
  const W = 720, H = 220, L = 46, B = 24, T = 8, max = niceMax(Math.max(...data.map((d) => d.value), 0)), pw = (W - L) / data.length, bw = Math.max(2, pw - 2);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = '';
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; s += `<line class="gl" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`; }
  data.forEach((d, i) => {
    const x = L + i * pw + 1, top = y(d.value), h = H - B - top, r = Math.min(4, bw / 2, h);
    s += `<g data-tip="${esc(d.tip || d.label + ': ' + fmt(d.value))}"><rect x="${L + i * pw}" y="${T}" width="${pw}" height="${H - T - B}" fill="transparent"/>`;
    if (h > 0) s += `<path class="bar" d="M${x},${H - B}V${top + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${H - B}Z"/>`;
    s += '</g>';
    if (i % every === 0) s += `<text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg></div>`;
}
function hBars(rows, fmt = inr) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows.map((r) => `<div class="hbar" data-tip="${esc(r.tip || r.name + ': ' + fmt(r.value))}"><span class="nm">${esc(r.name)}</span><span class="track"><i style="width:${(r.value / max) * 100}%"></i></span><span class="val">${esc(fmt(r.value))}</span></div>`).join('') || '<p class="muted">No data yet.</p>'}</div>`;
}

// ---------- shared bits ----------
const stateInfo = (m) => !m.last_seen ? ['idle', 'Never connected'] : !m.online ? ['crit', 'Offline'] : m.state === 'active' ? ['good', 'Selling'] : m.state === 'sleep' ? ['idle', 'Sleeping'] : ['warn', 'Maintenance'];
const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const sevPill = (s) => pill(s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'idle', s === 'critical' ? '● Critical' : s === 'warning' ? '▲ Warning' : 'Info');
const statusPill = (s) => pill({ completed: 'good', refunded: 'idle', refund_due: 'crit', vending: 'warn', pending: 'warn' }[s] || 'idle', s.replace('_', ' '));
async function machineOptions(sel, withAll = true) {
  const ms = await get('/api/machines');
  return (withAll ? '<option value="">All machines</option>' : '') + ms.map((m) => `<option value="${m.id}" ${String(sel) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}
const isAdmin = () => me.role === 'admin';

// ---------- views ----------
const views = {};

views.dashboard = async (el) => {
  const o = await get('/api/overview');
  const online = o.machines.filter((m) => m.online).length;
  el.innerHTML = `<div class="head"><h1>Dashboard</h1><span class="muted">Updates every 10 s</span></div>
  <div class="grid tiles">
    <div class="card tile"><div class="v">${inr(o.today.revenue)}</div><div class="l">Sales today</div></div>
    <div class="card tile"><div class="v">${o.today.orders}</div><div class="l">Orders today</div></div>
    <div class="card tile"><div class="v">${inr(o.today.profit)}</div><div class="l">Gross margin today</div></div>
    <div class="card tile"><div class="v">${online}/${o.machines.length}</div><div class="l">Machines online</div></div>
    <div class="card tile"><div class="v">${o.alerts.length}</div><div class="l">Open alerts</div></div>
    <div class="card tile"><div class="v">${o.refund_due}</div><div class="l">Refunds to process</div></div>
  </div>
  <div class="card section"><h2>Sales, last 14 days</h2>${barChart(o.trend.map((d) => ({ label: d.date.slice(8) + '/' + d.date.slice(5, 7), value: d.revenue })), inr, 2)}</div>
  <h2 class="section">Machines</h2>
  <div class="grid g3">${o.machines.map((m) => { const [c, t] = stateInfo(m), pct = m.stock_cap ? Math.round((m.stock_qty / m.stock_cap) * 100) : 0; return `
    <div class="card mcard"><div class="top"><div><b>${esc(m.name)}</b><div class="muted">${esc(m.location)}</div></div>${pill(c, t)}</div>
      <div><div class="row" style="justify-content:space-between"><span class="muted">Stock</span><span>${m.stock_qty}/${m.stock_cap} (${pct}%)</span></div><div class="meter"><i style="width:${pct}%"></i></div></div>
      <div class="facts"><span><b>${m.temp_c == null ? '—' : m.temp_c.toFixed(1) + ' °C'}</b>Cabinet</span><span><b>${m.door_open ? 'Open' : 'Closed'}</b>Door</span><span><b>${m.lights_on ? 'On' : 'Off'}</b>Lights</span></div>
      ${m.faults || m.open_alerts ? `<div class="row">${m.faults ? pill('crit', m.faults + ' slot fault' + (m.faults > 1 ? 's' : '')) : ''}${m.open_alerts ? pill('warn', m.open_alerts + ' alert' + (m.open_alerts > 1 ? 's' : '')) : ''}</div>` : ''}
      ${isAdmin() ? `<div class="row"><button class="small" data-act="${m.mode === 'sleep' ? 'wake' : 'sleep'}" data-id="${m.id}">${m.mode === 'sleep' ? 'Wake up' : 'Put to sleep'}</button>
      <button class="small" data-act="lights" data-id="${m.id}" data-on="${m.lights_on ? 1 : 0}">Lights ${m.lights_on ? 'off' : 'on'}</button><a href="#machines">More controls</a></div>` : ''}
    </div>`; }).join('')}</div>
  <div class="card section"><h2>Open alerts</h2>${alertTable(o.alerts)}</div>`;
  tipOn(el);
  el.onclick = guard(async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.act;
    if (a === 'sleep') await post(`/api/machines/${id}/control`, { mode: 'sleep' });
    else if (a === 'wake') await post(`/api/machines/${id}/control`, { mode: 'auto' });
    else if (a === 'lights') await post(`/api/machines/${id}/control`, { lights_mode: b.dataset.on === '1' ? 'off' : 'on' });
    else if (a === 'resolve') await post(`/api/alerts/${id}/resolve`);
    render();
  });
};
function alertTable(rows) {
  if (!rows.length) return '<p class="muted">No open alerts. Everything is running normally.</p>';
  return `<div class="tablewrap"><table><tr><th>Severity</th><th>Machine</th><th>What happened</th><th>Since</th><th></th></tr>${rows.map((a) => `<tr><td>${a.resolved_at ? pill('idle', 'Resolved') : sevPill(a.severity)}</td><td>${esc(a.machine || '—')}</td><td class="wrap">${esc(a.message)}</td><td>${when(a.created_at)}</td><td>${a.resolved_at ? '' : `<button class="small" data-act="resolve" data-id="${a.id}">Mark resolved</button>`}</td></tr>`).join('')}</table></div>`;
}

views.machines = async (el) => {
  const ms = await get('/api/machines');
  const seg = (name, val, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="head"><h1>Machines</h1>${isAdmin() ? '<button class="primary" id="addM">Add machine</button>' : ''}</div>
  <div class="grid g2">${ms.map((m) => { const [c, t] = stateInfo(m); return `
    <form class="card mcard" data-id="${m.id}"><div class="top"><div><b>${esc(m.name)}</b><div class="muted">${esc(m.location)}</div></div>${pill(c, t)}</div>
      <div class="muted">Last seen ${when(m.last_seen)} · firmware ${esc(m.fw || '—')} · ${m.rows}×${m.cols} slots${m.controller_ok ? '' : ' · controller NOT responding'}</div>
      <label>Power mode</label>${seg('mode', m.mode, [['auto', 'Follow schedule'], ['on', 'Always on'], ['sleep', 'Sleep'], ['maintenance', 'Maintenance']])}
      <div class="two"><label>Opens at<input type="time" name="open_time" value="${esc(m.open_time)}"></label><label>Closes at<input type="time" name="close_time" value="${esc(m.close_time)}"></label></div>
      <span class="muted">Used in “Follow schedule”. Same open and close time = open 24 hours. Closing time may be after midnight (e.g. 21:00 → 07:00 for hostels).</span>
      <label>Message shown on screen while sleeping<textarea name="sleep_message" maxlength="300">${esc(m.sleep_message)}</textarea></label>
      <label>Lights</label>${seg('lights_mode', m.lights_mode, [['auto', 'Auto (on when selling)'], ['on', 'On'], ['off', 'Off']])}
      ${isAdmin() ? `<div class="row"><button class="primary">Save settings</button>
        <button type="button" data-cmd="unlock">Unlock door</button><button type="button" data-cmd="test_vend">Test a slot</button><button type="button" data-cmd="reboot">Restart machine</button></div>
        <div class="row"><button type="button" class="link" data-cmd="key">New machine key</button><button type="button" class="link danger" data-cmd="delete">Delete machine</button></div>` : ''}
    </form>`; }).join('')}</div>`;
  el.onclick = guard(async (ev) => {
    const sb = ev.target.closest('.seg button');
    if (sb) { for (const b of sb.parentNode.children) b.classList.toggle('on', b === sb); return; }
    if (ev.target.id === 'addM') return modal('Add machine', `<label>Name<input name="name" required placeholder="e.g. TT Ground Floor"></label><label>Location note<input name="location"></label>
      <div class="two"><label>Trays (rows)<input name="rows" type="number" min="1" max="8" value="6"></label><label>Spirals per tray<input name="cols" type="number" min="1" max="10" value="8"></label></div>
      <label class="check"><input type="checkbox" name="cooled" checked> Has cooling unit</label>`, async (f) => { const r = await post('/api/machines', { ...f, rows: +f.rows, cols: +f.cols }); showKey(r.machine_key); render(); return false; }, 'Create');
    const b = ev.target.closest('[data-cmd]'); if (!b) return;
    const id = b.closest('form').dataset.id, cmd = b.dataset.cmd;
    if (cmd === 'key') { if (confirm('Create a new key? The machine stops working until its config is updated with the new key.')) showKey((await post(`/api/machines/${id}/key`)).machine_key); return; }
    if (cmd === 'delete') { if (confirm('Delete this machine and its slots? Sales history is kept.')) { await api('DELETE', `/api/machines/${id}`); render(); } return; }
    let slot; if (cmd === 'test_vend') { slot = prompt('Slot to test (e.g. A1). The motor will turn once — keep the slot empty or expect one item to drop.'); if (!slot) return; }
    if (cmd === 'reboot' && !confirm('Restart the machine computer now?')) return;
    const r = await post(`/api/machines/${id}/command`, { type: cmd, slot: slot && slot.toUpperCase() });
    toast('Command sent…');
    for (let i = 0; i < 20; i++) { await new Promise((r2) => setTimeout(r2, 1000)); const c = await get('/api/commands/' + r.command_id); if (c.status === 'done') return toast('Done ✔'); if (c.status === 'failed') return toast('Failed: ' + c.result); }
    toast('No reply from the machine yet');
  });
  el.onsubmit = guard(async (ev) => {
    ev.preventDefault(); const f = ev.target, body = Object.fromEntries(new FormData(f));
    for (const s of f.querySelectorAll('[data-seg]')) body[s.dataset.seg] = $('.on', s)?.dataset.v;
    await post(`/api/machines/${f.dataset.id}/control`, body); toast('Saved — the machine updates within a few seconds'); render();
  });
};
function showKey(key) {
  modal('Machine key', `<p>Copy this key into the machine's <code>config.json</code> now. It is shown only once.</p><div class="keybox">${esc(key)}</div>
    <p class="muted">Kiosk screen address: <span class="keybox" style="display:block;margin-top:4px">${esc(location.origin)}/kiosk/#key=${esc(key)}</span></p>`);
}

let stockMachine = '';
views.stock = async (el) => {
  const ms = await get('/api/machines'); if (!stockMachine && ms[0]) stockMachine = ms[0].id;
  const [slots, products, log] = await Promise.all([stockMachine ? get(`/api/machines/${stockMachine}/slots`) : [], get('/api/products'), get('/api/restock-log')]);
  const m = ms.find((x) => String(x.id) === String(stockMachine)) || { cols: 8 };
  el.innerHTML = `<div class="head"><h1>Stock & products</h1><div class="row"><select id="mSel">${ms.map((x) => `<option value="${x.id}" ${String(x.id) === String(stockMachine) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <button class="primary" id="fill">Mark all refilled to full</button></div></div>
  <div class="card"><h2>Slot layout <span class="muted" style="font-weight:400">— tap a slot to change product, quantity or clear a fault</span></h2>
    <div class="slots" style="grid-template-columns:repeat(${m.cols},minmax(92px,1fr))">${slots.map((s) => `<button class="slot ${s.fault ? 'fault' : ''} ${s.enabled ? '' : 'off'}" data-slot="${s.id}">
      <span class="code">${esc(s.code)}<span>${s.fault ? '⚠ fault' : s.product_id ? `${s.qty}/${s.capacity}` : ''}</span></span><span class="nm">${s.product_id ? esc(s.emoji + ' ' + s.product) : '<span class="muted">empty</span>'}</span>
      <span class="meter"><i style="width:${s.product_id ? (s.qty / s.capacity) * 100 : 0}%"></i></span></button>`).join('')}</div></div>
  <div class="card section"><div class="head"><h2>Product catalogue</h2>${isAdmin() ? '<button id="addP">Add product</button>' : ''}</div>
    <div class="tablewrap"><table><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th>Supplier</th><th></th></tr>
    ${products.map((p) => `<tr><td>${esc(p.emoji + ' ' + p.name)}${p.active ? '' : ' ' + pill('idle', 'inactive')}</td><td>${esc(p.category)}</td><td class="num">${inr(p.price)}</td><td class="num">₹${p.cost.toFixed(2)}</td><td class="num">${(((p.price - p.cost) / p.price) * 100).toFixed(0)}%</td><td>${esc(p.supplier)}</td><td>${isAdmin() ? `<button class="small" data-prod="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</table></div></div>
  <div class="card section"><h2>Restock history</h2><div class="tablewrap"><table><tr><th>When</th><th>Machine</th><th>Slot</th><th>Product</th><th>By</th><th class="num">Before</th><th class="num">After</th></tr>
    ${log.slice(0, 40).map((r) => `<tr><td>${when(r.at)}</td><td>${esc(r.machine)}</td><td>${esc(r.slot_code)}</td><td>${esc(r.product_name || '—')}</td><td>${esc(r.username)}</td><td class="num">${r.qty_before}</td><td class="num">${r.qty_after}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No restocks recorded yet.</td></tr>'}</table></div></div>`;
  $('#mSel').onchange = (ev) => { stockMachine = ev.target.value; render(); };
  $('#fill').onclick = guard(async () => { if (confirm('Record that every slot was refilled to full capacity?')) { await post(`/api/machines/${stockMachine}/restock`, { fill: true }); render(); } });
  const prodForm = (p = {}) => `<label>Name<input name="name" required value="${esc(p.name || '')}"></label>
    <div class="two"><label>Category<input name="category" required list="cats" value="${esc(p.category || '')}"><datalist id="cats">${[...new Set(products.map((x) => x.category))].map((c) => `<option>${esc(c)}`).join('')}</datalist></label><label>Icon (emoji)<input name="emoji" value="${esc(p.emoji || '🍫')}"></label></div>
    <div class="two"><label>Selling price ₹<input name="price" type="number" step="0.5" min="1" required value="${p.price ?? ''}"></label><label>Cost price ₹<input name="cost" type="number" step="0.01" min="0" value="${p.cost ?? ''}"></label></div>
    <label>Supplier<input name="supplier" value="${esc(p.supplier || '')}"></label><label class="check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}> Active</label>`;
  el.onclick = guard(async (ev) => {
    if (ev.target.id === 'addP') return modal('Add product', prodForm(), async (f) => { await post('/api/products', { ...f, price: +f.price, cost: +f.cost }); render(); });
    const pb = ev.target.closest('[data-prod]');
    if (pb) { const p = products.find((x) => x.id === +pb.dataset.prod); return modal('Edit product', prodForm(p), async (f) => { await put('/api/products/' + p.id, { ...f, price: +f.price, cost: +f.cost }); render(); }); }
    const sb = ev.target.closest('[data-slot]'); if (!sb) return;
    const s = slots.find((x) => x.id === +sb.dataset.slot);
    modal('Slot ' + s.code, `<label>Product<select name="product_id" ${isAdmin() ? '' : 'disabled'}><option value="">— empty —</option>${products.filter((p) => p.active || p.id === s.product_id).map((p) => `<option value="${p.id}" ${p.id === s.product_id ? 'selected' : ''}>${esc(p.name)} (${inr(p.price)})</option>`).join('')}</select></label>
      <div class="two"><label>Quantity now<input name="qty" type="number" min="0" max="40" value="${s.qty}"></label><label>Capacity<input name="capacity" type="number" min="1" max="40" value="${s.capacity}" ${isAdmin() ? '' : 'disabled'}></label></div>
      ${isAdmin() ? `<label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Slot enabled (shown to customers)</label>
      <label class="check"><input type="checkbox" name="fault" ${s.fault ? 'checked' : ''}> Fault flag (untick after the jam is cleared)</label>` : ''}`,
      async (f) => {
        if (isAdmin()) await put('/api/slots/' + s.id, { product_id: f.product_id ? +f.product_id : null, qty: +f.qty, capacity: +f.capacity, enabled: f.enabled, fault: f.fault });
        else await post(`/api/machines/${stockMachine}/restock`, { items: [{ code: s.code, qty: +f.qty }] });
        render();
      });
  });
};

let fcMachine = '', fcH = 7;
views.forecast = async (el) => {
  const [f, opts] = await Promise.all([get(`/api/forecast?horizon=${fcH}&machine=${fcMachine}`), machineOptions(fcMachine)]);
  const st = { empty: ['crit', '● Empty'], critical: ['crit', '● Under 1 day'], soon: ['warn', '▲ Under 2 days'], ok: ['good', 'OK'] };
  const urgent = f.rows.filter((r) => r.status !== 'ok').sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));
  el.innerHTML = `<div class="head"><h1>Forecast & requirements</h1><div class="row"><select id="fm">${opts}</select><select id="fh">${[3, 7, 14, 30].map((d) => `<option value="${d}" ${d === fcH ? 'selected' : ''}>Next ${d} days</option>`).join('')}</select></div></div>
  <p class="muted">Based on each machine's sales over the last 28 days (recent week weighted more). “To buy” is the demand for the period minus what is already inside the machines.</p>
  <div class="grid tiles"><div class="card tile"><div class="v">${f.purchase.reduce((a, p) => a + p.units, 0)}</div><div class="l">Units to buy for next ${fcH} days</div></div>
    <div class="card tile"><div class="v">${inr(f.purchase.reduce((a, p) => a + p.value, 0))}</div><div class="l">Purchase budget needed</div></div>
    <div class="card tile"><div class="v">${urgent.length}</div><div class="l">Products running out within 2 days</div></div></div>
  <div class="card section"><h2>Purchase list</h2><div class="tablewrap"><table><tr><th>Product</th><th>Category</th><th>Supplier</th><th class="num">Sells / day</th><th class="num">In machines</th><th class="num">Demand</th><th class="num">To buy</th><th class="num">Cost</th></tr>
    ${f.purchase.map((p) => `<tr><td>${esc(p.product)}</td><td>${esc(p.category)}</td><td>${esc(p.supplier)}</td><td class="num">${p.per_day}</td><td class="num">${p.in_machines}</td><td class="num">${p.demand}</td><td class="num"><b>${p.units}</b></td><td class="num">${inr(p.value)}</td></tr>`).join('')}</table></div></div>
  <div class="card section"><h2>Refill priorities by machine</h2><div class="tablewrap"><table><tr><th>Status</th><th>Machine</th><th>Product</th><th class="num">In stock</th><th class="num">Sells / day</th><th class="num">Days left</th><th class="num">Refill now</th></tr>
    ${[...urgent, ...f.rows.filter((r) => r.status === 'ok')].map((r) => `<tr><td>${pill(...st[r.status])}</td><td>${esc(r.machine)}</td><td>${esc(r.product)}</td><td class="num">${r.qty}/${r.capacity}</td><td class="num">${r.per_day}</td><td class="num">${r.days_left ?? '—'}</td><td class="num">${r.refill_now}</td></tr>`).join('')}</table></div></div>`;
  $('#fm').onchange = (e) => { fcMachine = e.target.value; render(); }; $('#fh').onchange = (e) => { fcH = +e.target.value; render(); };
};

const pf = { machine: '', status: '', method: '', from: '', to: '' };
views.payments = async (el) => {
  const qs = new URLSearchParams(Object.entries(pf).filter(([, v]) => v)).toString();
  const [d, opts] = await Promise.all([get('/api/orders?' + qs), machineOptions(pf.machine)]);
  const sum = (fn) => d.summary.filter(fn).reduce((a, s) => ({ n: a.n + s.n, amount: a.amount + s.amount }), { n: 0, amount: 0 });
  const done = sum((s) => s.status === 'completed'), upi = sum((s) => s.status === 'completed' && s.method === 'upi'), card = sum((s) => s.status === 'completed' && s.method === 'card'), ref = sum((s) => s.status === 'refunded'), due = sum((s) => s.status === 'refund_due');
  const sel = (k, o) => `<select data-f="${k}">${o.map(([v, l]) => `<option value="${v}" ${pf[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="head"><h1>Payments</h1><a href="/api/orders.csv?${esc(qs)}"><button>Download CSV</button></a></div>
  <div class="row" style="margin-bottom:14px"><select data-f="machine">${opts}</select>
    ${sel('status', [['', 'Any status'], ['completed', 'Completed'], ['refund_due', 'Refund due'], ['refunded', 'Refunded'], ['pending', 'Pending'], ['expired', 'Expired'], ['cancelled', 'Cancelled']])}
    ${sel('method', [['', 'UPI + card'], ['upi', 'UPI'], ['card', 'Card']])}
    <label class="row">From <input type="date" data-f="from" value="${esc(pf.from)}"></label><label class="row">To <input type="date" data-f="to" value="${esc(pf.to)}"></label></div>
  <div class="grid tiles"><div class="card tile"><div class="v">${inr(done.amount)}</div><div class="l">Collected (${done.n} orders)</div></div>
    <div class="card tile"><div class="v">${inr(upi.amount)}</div><div class="l">UPI (${upi.n})</div></div><div class="card tile"><div class="v">${inr(card.amount)}</div><div class="l">Card (${card.n})</div></div>
    <div class="card tile"><div class="v">${inr(ref.amount)}</div><div class="l">Refunded (${ref.n})</div></div><div class="card tile"><div class="v">${inr(due.amount)}</div><div class="l">Refund due (${due.n})</div></div></div>
  <div class="card section"><h2>Transactions <span class="muted" style="font-weight:400">(latest 300)</span></h2><div class="tablewrap"><table><tr><th>#</th><th>Time</th><th>Machine</th><th>Slot</th><th>Product</th><th class="num">Amount</th><th>Method</th><th>Status</th><th>Payment ref</th><th></th></tr>
    ${d.rows.map((o) => `<tr><td>${o.id}</td><td>${when(o.created_at)}</td><td>${esc(o.machine)}</td><td>${esc(o.slot_code)}</td><td>${esc(o.product_name)}</td><td class="num">${inr(o.amount)}</td><td>${esc(o.method.toUpperCase())}</td><td>${statusPill(o.status)}</td><td>${esc(o.payment_id || (o.provider === 'demo' ? 'demo data' : '—'))}</td>
      <td>${o.status === 'refund_due' && isAdmin() ? `<button class="small" data-ref="${o.id}">Mark refunded</button>` : esc(o.note || '')}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No transactions match.</td></tr>'}</table></div></div>`;
  el.onchange = (ev) => { const k = ev.target.dataset.f; if (k) { pf[k] = ev.target.value; render(); } };
  el.onclick = guard(async (ev) => { const b = ev.target.closest('[data-ref]'); if (b && confirm('Confirm you have refunded this customer through the payment provider?')) { await post(`/api/orders/${b.dataset.ref}/refunded`); render(); } });
};

let anDays = 30, anMachine = '';
views.analytics = async (el) => {
  const [a, opts] = await Promise.all([get(`/api/analytics?days=${anDays}&machine=${anMachine}`), machineOptions(anMachine)]);
  const t = a.totals, hrs = a.by_hour.map((h) => ({ label: String(h.hour).padStart(2, '0'), value: h.orders, tip: `${String(h.hour).padStart(2, '0')}:00–${String(h.hour + 1).padStart(2, '0')}:00\n${h.orders} orders, ${inr(h.revenue)}` }));
  const peak = [...a.by_hour].sort((x, y) => y.orders - x.orders)[0];
  const hb = (rows) => hBars(rows.map((r) => ({ name: r.name, value: r.revenue, tip: `${r.name}\n${inr(r.revenue)} · ${r.orders} orders · margin ${inr(r.profit)}` })));
  el.innerHTML = `<div class="head"><h1>Analytics</h1><div class="row"><select id="am">${opts}</select><select id="ad">${[7, 30, 90].map((d) => `<option value="${d}" ${d === anDays ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select></div></div>
  <div class="grid tiles"><div class="card tile"><div class="v">${inr(t.revenue)}</div><div class="l">Sales</div></div><div class="card tile"><div class="v">${t.orders.toLocaleString('en-IN')}</div><div class="l">Orders</div></div>
    <div class="card tile"><div class="v">${inr(t.profit)}</div><div class="l">Gross margin (${t.revenue ? ((t.profit / t.revenue) * 100).toFixed(0) : 0}%)</div></div>
    <div class="card tile"><div class="v">₹${t.avg_ticket.toFixed(1)}</div><div class="l">Average order</div></div><div class="card tile"><div class="v">${t.failed_vends}</div><div class="l">Failed vends (refunded)</div></div>
    <div class="card tile"><div class="v">${peak && peak.orders ? String(peak.hour).padStart(2, '0') + ':00' : '—'}</div><div class="l">Busiest hour</div></div></div>
  <div class="card section"><h2>Sales per day (₹)</h2>${barChart(a.by_day.map((d) => ({ label: d.date.slice(8) + '/' + d.date.slice(5, 7), value: d.revenue, tip: `${d.date}\n${inr(d.revenue)} · ${d.orders} orders` })), inr, Math.ceil(a.by_day.length / 10))}</div>
  <div class="card section"><h2>Orders by hour of day</h2>${barChart(hrs, (v) => String(Math.round(v)), 2)}</div>
  <div class="grid g2 section"><div class="card"><h2>Sales by category</h2>${hb(a.by_category)}</div><div class="card"><h2>Sales by machine</h2>${hb(a.by_machine)}</div>
    <div class="card"><h2>Top 10 products</h2>${hb(a.top_products)}</div><div class="card"><h2>Payment method</h2>${hb(a.by_method.map((m) => ({ ...m, name: m.name.toUpperCase() })))}</div></div>`;
  tipOn(el);
  $('#am').onchange = (e) => { anMachine = e.target.value; render(); }; $('#ad').onchange = (e) => { anDays = +e.target.value; render(); };
};

views.alerts = async (el) => {
  const rows = await get('/api/alerts');
  el.innerHTML = `<div class="head"><h1>Alerts & service</h1></div><p class="muted">Raised automatically for: machine offline, motor/slot jam, failed delivery, refund problems, high temperature, door opened without service login, tilt, low stock, controller or payment-gateway faults. Sent to Telegram / webhook when configured in Settings.</p>
    <div class="card">${alertTable(rows)}</div>`;
  el.onclick = guard(async (ev) => { const b = ev.target.closest('[data-act=resolve]'); if (b) { await post(`/api/alerts/${b.dataset.id}/resolve`); render(); } });
};

views.settings = async (el) => {
  if (!isAdmin()) return (el.innerHTML = '<h1>Settings</h1><p class="muted">Only admins can change settings.</p>');
  const [s, users] = await Promise.all([get('/api/settings'), get('/api/users')]);
  el.innerHTML = `<div class="head"><h1>Settings</h1></div><div class="grid g2">
  <form class="card grid" id="setForm"><h2>Alerts & thresholds</h2>
    <label>Telegram bot token<input name="telegram_token" value="${esc(s.telegram_token)}" placeholder="from @BotFather" autocomplete="off"></label>
    <label>Telegram chat ID<input name="telegram_chat_id" value="${esc(s.telegram_chat_id)}"></label>
    <label>Webhook URL (optional — Slack, Teams, etc.)<input name="webhook_url" value="${esc(s.webhook_url)}" placeholder="https://…"></label>
    <div class="two"><label>High temperature alert above (°C)<input name="temp_max_c" type="number" value="${esc(s.temp_max_c)}"></label><label>Low stock alert when % of slots low<input name="low_stock_pct" type="number" value="${esc(s.low_stock_pct)}"></label></div>
    <label>Campus name on kiosk<input name="campus_name" value="${esc(s.campus_name)}"></label>
    <div class="row"><button class="primary">Save</button><button type="button" id="testN">Send test alert</button></div>
    <p class="muted">Payments: UPI provider “${esc(me.payments.upi)}”, card provider “${esc(me.payments.card)}”. These are set with environment variables on the server (see README).</p></form>
  <div class="card"><div class="head"><h2>Users</h2><button id="addU">Add user</button></div>
    <table><tr><th>Username</th><th>Role</th><th>Service PIN</th><th></th></tr>${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.has_pin ? 'set' : '—'}</td><td class="row"><button class="small" data-pw="${u.id}">Password</button><button class="small" data-pin="${u.id}">PIN</button><button class="small danger" data-del="${u.id}">Delete</button></td></tr>`).join('')}</table>
    <p class="muted">Admins control everything. Restockers can only view stock and record refills. The 6-digit service PIN opens the restock menu on the machine's screen (tap the logo 5 times).</p></div></div>`;
  $('#setForm').onsubmit = guard(async (ev) => { ev.preventDefault(); await put('/api/settings', Object.fromEntries(new FormData(ev.target))); toast('Settings saved'); });
  $('#testN').onclick = guard(async () => { await post('/api/settings/test-notify'); toast('Test alert sent (if Telegram/webhook are configured)'); });
  el.onclick = guard(async (ev) => {
    const d = ev.target.dataset;
    if (ev.target.id === 'addU') modal('Add user', `<label>Username<input name="username" required></label><label>Password (8+ characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>Role<select name="role"><option value="restocker">Restocker</option><option value="admin">Admin</option></select></label><label>6-digit service PIN (optional)<input name="pin" inputmode="numeric" pattern="\\d{6}" autocomplete="off"></label>`, async (f) => { await post('/api/users', f); render(); }, 'Create');
    else if (d.pw) modal('Change password', '<label>New password (8+ characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>', async (f) => { await put('/api/users/' + d.pw, f); toast('Password changed'); });
    else if (d.pin) modal('Set service PIN', '<label>New 6-digit PIN<input name="pin" inputmode="numeric" pattern="\\d{6}" required autocomplete="off"></label>', async (f) => { await put('/api/users/' + d.pin, f); render(); });
    else if (d.del && confirm('Delete this user?')) { await api('DELETE', '/api/users/' + d.del); render(); }
  });
};

// ---------- shell ----------
const NAV = [['dashboard', 'Dashboard'], ['machines', 'Machines'], ['stock', 'Stock & products'], ['forecast', 'Forecast'], ['payments', 'Payments'], ['analytics', 'Analytics'], ['alerts', 'Alerts'], ['settings', 'Settings']];
async function render() {
  if (!me) return;
  const name = views[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  $('#nav').innerHTML = NAV.map(([k, l]) => `<a href="#${k}" class="${k === name ? 'on' : ''}">${l}</a>`).join('');
  clearInterval(timer);
  try { await views[name]($('#view')); } catch (e) { if (me) $('#view').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  if (name === 'dashboard') timer = setInterval(() => { if (!$('#dlg').open && location.hash.slice(1) in { '': 1, dashboard: 1 }) views.dashboard($('#view')).catch(() => {}); }, 10000);
}
function showLogin() { me = null; clearInterval(timer); $('#app').hidden = true; $('#login').hidden = false; }
async function boot() {
  try { me = await get('/api/me'); } catch { return showLogin(); }
  $('#login').hidden = true; $('#app').hidden = false; $('#who').textContent = `${me.username} (${me.role})`; $('#demoBanner').hidden = !me.payments.demo;
  render();
}
$('#loginForm').onsubmit = async (ev) => {
  ev.preventDefault();
  try { await post('/api/login', Object.fromEntries(new FormData(ev.target))); ev.target.reset(); $('#loginError').textContent = ''; boot(); } catch (e) { $('#loginError').textContent = e.message; }
};
$('#logout').onclick = async () => { await post('/api/logout').catch(() => {}); showLogin(); };
window.addEventListener('hashchange', render);
boot();
