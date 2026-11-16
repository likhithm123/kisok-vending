'use strict';
/* CampusVend kiosk touchscreen UI. Runs full-screen in Chromium on the machine's Raspberry Pi. */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The machine key arrives once in the URL fragment (#key=...) and is then kept in local storage.
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.get('key')) { try { localStorage.setItem('cv_key', frag.get('key')); } catch {} history.replaceState(null, '', location.pathname); }
let KEY = frag.get('key'); try { KEY = KEY || localStorage.getItem('cv_key'); } catch {}

let state = null, screen = '', category = 'All', picked = null, order = null, svc = null, pinBuf = '', idleT = null, tickT = null, pollT = null, logoTaps = [];

async function api(method, url, body, extra = {}) {
  const r = await fetch(url, { method, headers: { 'X-Machine-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong'); e.status = r.status; throw e; }
  return j;
}
function show(id) {
  screen = id;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
  clearTimeout(idleT);
  if (['confirm', 'pin', 'done'].includes(id)) idleT = setTimeout(home, id === 'done' ? 8000 : 45000);
}
function home() { clearInterval(tickT); clearInterval(pollT); picked = null; order = null; pinBuf = ''; refresh(true); }

// ---------- state / browse ----------
async function refresh(force) {
  if (!KEY) return show('setup');
  try { state = await api('GET', '/api/kiosk/state'); }
  catch (e) {
    if (e.status === 401) { $('#setupErr').textContent = 'This machine key is not valid.'; return show('setup'); }
    state = { machine: { state: 'offline', message: '' }, slots: [], payments: {} };
  }
  const busy = ['confirm', 'pay', 'vend', 'done', 'pin', 'service'].includes(screen);
  if (busy && !force) return;
  const m = state.machine;
  if (m.state !== 'active') {
    const t = { sleep: ['😴', 'Sleeping', m.message], maintenance: ['🛠️', 'Under maintenance', m.message], offline: ['📡', 'Temporarily unavailable', 'This machine is reconnecting. Please try again in a minute.'] }[m.state];
    $('#sleepIcon').textContent = t[0]; $('#sleepTitle').textContent = t[1]; $('#sleepMsg').textContent = t[2];
    return show('sleep');
  }
  $('#mName').textContent = m.name; $('#mCampus').textContent = m.campus;
  $('#cardNote').hidden = !state.payments.card_enabled; $('#payCard').hidden = !state.payments.card_enabled;
  const cats = ['All', ...new Set(state.slots.map((s) => s.category))];
  if (!cats.includes(category)) category = 'All';
  $('#tabs').innerHTML = cats.map((c) => `<button data-cat="${esc(c)}" class="${c === category ? 'on' : ''}">${esc(c)}</button>`).join('');
  const list = state.slots.filter((s) => category === 'All' || s.category === category);
  $('#grid').innerHTML = list.map((s) => `<button class="item ${s.available ? '' : 'out'}" data-slot="${esc(s.code)}" ${s.available ? '' : 'disabled'}>
    <span class="code">${esc(s.code)}</span><span class="em">${esc(s.emoji)}</span><span class="nm">${esc(s.product)}</span><span class="pr">${s.available ? '₹' + s.price : 'Sold out'}</span></button>`).join('')
    || '<p class="sub">Nothing loaded yet.</p>';
  show('browse');
}
$('#tabs').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { category = b.dataset.cat; refresh(true); } };
$('#grid').onclick = (e) => {
  const b = e.target.closest('[data-slot]'); if (!b) return;
  picked = state.slots.find((s) => s.code === b.dataset.slot);
  $('#cEm').textContent = picked.emoji; $('#cName').textContent = picked.product; $('#cPrice').textContent = '₹' + picked.price; $('#cErr').textContent = '';
  show('confirm');
};
document.addEventListener('click', (e) => { if (e.target.closest('[data-home]')) home(); });

// ---------- payment ----------
async function startPay(method) {
  $('#payUpi').disabled = $('#payCard').disabled = true;
  try {
    order = await api('POST', '/api/kiosk/order', { slot: picked.code, method });
    $('#pTitle').textContent = `₹${order.amount} · ${order.product}`;
    if (method === 'card') {
      $('#pBody').innerHTML = '<div class="huge">💳</div>';
      $('#pHint').textContent = 'Tap or insert your debit / credit card on the card reader below the screen.';
    } else if (order.qr_image) {
      $('#pBody').innerHTML = `<div class="qr"><img alt="UPI QR code" src="${esc(order.qr_image)}"></div>`;
      $('#pHint').textContent = 'Scan with any UPI app — GPay, PhonePe, Paytm, BHIM…';
    } else {
      $('#pBody').innerHTML = '<div class="qr demo">DEMO MODE<br>no real payment</div>';
      $('#pHint').textContent = 'Demo mode: no money is collected.';
    }
    if (order.demo) $('#pBody').insertAdjacentHTML('beforeend', '<p><button class="btn alt" id="demoPay">Simulate successful payment</button></p>');
    let left = order.expires_in - 10;
    const tick = () => { $('#pCount').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; if (left-- <= 0) cancelPay(); };
    tick(); tickT = setInterval(tick, 1000);
    pollT = setInterval(pollOrder, 1200);
    show('pay');
  } catch (e) { $('#cErr').textContent = e.message; }
  $('#payUpi').disabled = $('#payCard').disabled = false;
}
async function pollOrder() {
  if (!order) return;
  let o; try { o = await api('GET', '/api/kiosk/order/' + order.id); } catch { return; }
  if (o.status === 'vending' && screen !== 'vend') { clearInterval(tickT); show('vend'); }
  else if (o.status === 'completed') finish('✅', 'Enjoy!', 'Please collect your item from the tray.');
  else if (o.status === 'refunded' || o.status === 'refund_due') finish('⚠️', 'Sorry — item not delivered', `Your payment of ₹${order.amount} is being refunded automatically to the same account (usually within a few working days). Order #${order.id}.`);
  else if (o.status === 'expired' || o.status === 'cancelled') home();
}
function finish(icon, title, msg) { clearInterval(tickT); clearInterval(pollT); $('#dIcon').textContent = icon; $('#dTitle').textContent = title; $('#dMsg').textContent = msg; order = null; show('done'); }
async function cancelPay() { const o = order; clearInterval(tickT); clearInterval(pollT); if (o) await api('POST', `/api/kiosk/order/${o.id}/cancel`, {}).catch(() => {}); home(); }
$('#payUpi').onclick = () => startPay('upi'); $('#payCard').onclick = () => startPay('card'); $('#pCancel').onclick = cancelPay;
$('#pBody').onclick = (e) => { if (e.target.id === 'demoPay' && order) { e.target.disabled = true; api('POST', `/api/kiosk/order/${order.id}/demo-pay`, {}).catch(() => {}); } };

// ---------- service / restock menu (tap the logo 5 times within 3 seconds) ----------
$('#logo').onclick = () => {
  const t = Date.now(); logoTaps = logoTaps.filter((x) => t - x < 3000); logoTaps.push(t);
  if (logoTaps.length >= 5) { logoTaps = []; pinBuf = ''; $('#dots').textContent = ''; $('#pinErr').textContent = ''; show('pin'); }
};
$('#pinpad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => `<button data-k="${k}">${k}</button>`).join('');
$('#pinpad').onclick = async (e) => {
  const k = e.target.dataset.k; if (!k) return;
  if (k === '⌫') pinBuf = pinBuf.slice(0, -1); else if (k !== 'OK' && pinBuf.length < 6) pinBuf += k;
  $('#dots').textContent = '●'.repeat(pinBuf.length);
  if (k === 'OK' || pinBuf.length === 6) {
    try { svc = await api('POST', '/api/kiosk/service/login', { pin: pinBuf }); $('#svcWho').textContent = svc.username; renderService(); show('service'); }
    catch (err) { $('#pinErr').textContent = err.message; }
    pinBuf = ''; $('#dots').textContent = '';
  }
};
function renderService() {
  $('#svcList').innerHTML = svc.slots.filter((s) => s.product_id).map((s) => `<div class="svcrow ${s.fault ? 'fault' : ''}" data-code="${esc(s.code)}"><b>${esc(s.code)}</b>
    <span>${esc(s.emoji + ' ' + s.product)}${s.fault ? ' — <span style="color:var(--bad)">FAULT: clear jam, then save</span>' : ''}</span>
    <span class="step"><button data-d="-1">−</button><b>${s.qty} / ${s.capacity}</b><button data-d="1">+</button><button data-d="full">⤒</button></span></div>`).join('');
}
$('#svcList').onclick = (e) => {
  const d = e.target.dataset.d; if (!d) return;
  const s = svc.slots.find((x) => x.code === e.target.closest('.svcrow').dataset.code);
  s.qty = d === 'full' ? s.capacity : Math.max(0, Math.min(s.capacity, s.qty + +d)); renderService();
};
const svcCall = (path, body = {}) => api('POST', '/api/kiosk/service/' + path, body, { 'X-Service-Token': svc.token });
$('#svcUnlock').onclick = async (e) => { e.target.disabled = true; try { await svcCall('unlock'); e.target.textContent = 'Door unlocked (10 s)'; } catch (err) { e.target.textContent = err.message; } setTimeout(() => { e.target.disabled = false; e.target.textContent = 'Unlock door'; }, 10000); };
$('#svcFill').onclick = () => { for (const s of svc.slots) if (s.product_id) s.qty = s.capacity; renderService(); };
$('#svcSave').onclick = async () => {
  try { await svcCall('restock', { items: svc.slots.filter((s) => s.product_id).map((s) => ({ code: s.code, qty: s.qty })) }); await svcCall('logout'); } catch {}
  svc = null; home();
};

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }, 1000);
setInterval(() => refresh(false), 5000);
document.addEventListener('contextmenu', (e) => e.preventDefault());
refresh(true);
