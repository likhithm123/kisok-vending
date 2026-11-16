'use strict';
/*
 * CampusVend server — admin portal + kiosk UI + machine agent API.
 * Zero npm dependencies. Run:  node server.js   (Node 22.5+)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { all, one, run, now, hashSecret, verifySecret, sha256, newKey, getSetting, setSetting, DEFAULT_SETTINGS, createSlots, ensureAdmin } = require('./db');
const pay = require('./lib/payments');
const { forecast } = require('./lib/forecast');

const PORT = +(process.env.PORT || 8080);
const ORDER_TTL = 180000;        // customer has 3 minutes to pay
const VEND_TIMEOUT = 60000;      // machine must confirm the drop within 60 s
const ONLINE_WINDOW = 45000;     // machine counts as online if seen in the last 45 s
const DAY = 86400000, IST = 5.5 * 3600000;

ensureAdmin();

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istHour = (ms) => new Date(ms + IST).getUTCHours();
const istMinutes = (ms) => { const d = new Date(ms + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const startOfIstDay = (ms) => Math.floor((ms + IST) / DAY) * DAY - IST;
const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const isOnline = (m) => !!m.last_seen && now() - m.last_seen < ONLINE_WINDOW;

// What the machine should be doing right now (manual mode beats the schedule).
function effective(m) {
  let state = 'active', message = '';
  if (m.mode === 'maintenance') { state = 'maintenance'; message = 'Under maintenance. Sorry for the inconvenience.'; }
  else if (m.mode === 'sleep') { state = 'sleep'; message = m.sleep_message; }
  else if (m.mode === 'auto' && m.open_time !== m.close_time) {
    const t = istMinutes(now()), o = hm(m.open_time), c = hm(m.close_time);
    const open = o < c ? t >= o && t < c : t >= o || t < c;   // window may wrap past midnight
    if (!open) { state = 'sleep'; message = `${m.sleep_message}\nOpens at ${m.open_time}.`; }
  }
  const lights = m.lights_mode === 'on' ? true : m.lights_mode === 'off' ? false : state === 'active';
  return { state, message, lights };
}

// ---------- alerts + notifications ----------
async function notify(text) {
  const token = getSetting('telegram_token'), chat = getSetting('telegram_chat_id'), hook = getSetting('webhook_url');
  const jobs = [];
  if (token && chat) jobs.push(fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(10000) }));
  if (hook) jobs.push(fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000) }));
  for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') console.warn('[notify] failed:', r.reason?.message);
}
function raiseAlert(machineId, type, severity, message) {
  if (one('SELECT id FROM alerts WHERE machine_id IS ? AND type=? AND resolved_at IS NULL', machineId, type)) return;
  run('INSERT INTO alerts(machine_id,type,severity,message,created_at) VALUES(?,?,?,?,?)', machineId, type, severity, message, now());
  const m = machineId ? one('SELECT name FROM machines WHERE id=?', machineId) : null;
  const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  notify(`${icon} CampusVend${m ? ' — ' + m.name : ''}\n${message}`);
}
function resolveAlert(machineId, type) {
  run('UPDATE alerts SET resolved_at=? WHERE machine_id IS ? AND type=? AND resolved_at IS NULL', now(), machineId, type);
}
function checkStock(machineId) {
  const s = one('SELECT COUNT(*) n, SUM(qty<=capacity*0.2) low, SUM(qty=0) empty FROM slots WHERE machine_id=? AND enabled=1 AND product_id IS NOT NULL', machineId);
  const pct = +getSetting('low_stock_pct') || 25;
  if (s.n && (s.low / s.n) * 100 >= pct) raiseAlert(machineId, 'low_stock', 'warning', `Restock needed: ${s.low} of ${s.n} slots are low (${s.empty} empty).`);
  else resolveAlert(machineId, 'low_stock');
}

// ---------- command queue (long-polled by the machine agent) ----------
const waiters = new Map(); // machineId -> wake function
function enqueue(machineId, type, payload = {}) {
  const r = run('INSERT INTO commands(machine_id,type,payload,created_at) VALUES(?,?,?,?)', machineId, type, JSON.stringify(payload), now());
  const w = waiters.get(machineId); if (w) w();
  return Number(r.lastInsertRowid);
}
function takeCommands(machineId) {
  const cmds = all("SELECT id,type,payload FROM commands WHERE machine_id=? AND status='queued' ORDER BY id", machineId);
  for (const c of cmds) run("UPDATE commands SET status='sent' WHERE id=?", c.id);
  return cmds.map((c) => ({ id: c.id, type: c.type, ...JSON.parse(c.payload) }));
}

// ---------- order lifecycle ----------
function markPaid(orderId, paymentId) {
  const o = one('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.status !== 'pending') return;
  const slot = one('SELECT * FROM slots WHERE id=?', o.slot_id);
  run("UPDATE orders SET status='vending', paid_at=?, payment_id=? WHERE id=?", now(), paymentId || null, o.id);
  enqueue(o.machine_id, 'vend', { order_id: o.id, slot: slot.code, row: slot.row, col: slot.col });
}
async function vendFailed(o, reason) {
  run("UPDATE orders SET status='refund_due', note=?, completed_at=? WHERE id=? AND status='vending'", reason, now(), o.id);
  run('UPDATE slots SET fault=1 WHERE id=?', o.slot_id);
  raiseAlert(o.machine_id, 'vend_fail_' + o.slot_code, 'critical', `Slot ${o.slot_code} failed to deliver "${o.product_name}" (order #${o.id}): ${reason}. Slot disabled; refund started.`);
  const r = await pay.refund(o);
  if (r.ok) run("UPDATE orders SET status='refunded', refund_ref=? WHERE id=?", r.ref, o.id);
  else raiseAlert(o.machine_id, 'refund_due', 'critical', 'Automatic refund failed for at least one order — refund it manually in Payments.');
}
function vendResult(machineId, res) {
  const cmd = one('SELECT * FROM commands WHERE id=? AND machine_id=?', res.id, machineId);
  if (!cmd || cmd.status === 'done' || cmd.status === 'failed') return;
  run('UPDATE commands SET status=?, result=? WHERE id=?', res.ok ? 'done' : 'failed', String(res.error || 'ok').slice(0, 200), cmd.id);
  const p = JSON.parse(cmd.payload);
  if (cmd.type !== 'vend' || !p.order_id) return;
  const o = one('SELECT * FROM orders WHERE id=?', p.order_id);
  if (!o || o.status !== 'vending') return;
  if (res.ok) {
    run("UPDATE orders SET status='completed', completed_at=? WHERE id=?", now(), o.id);
    run('UPDATE slots SET qty=MAX(qty-1,0) WHERE id=?', o.slot_id);
    checkStock(machineId);
  } else vendFailed(o, res.error || 'motor fault');
}

setInterval(() => {
  const t = now();
  run("UPDATE orders SET status='expired' WHERE status='pending' AND created_at<?", t - ORDER_TTL - 15000);
  for (const o of all("SELECT * FROM orders WHERE status='vending' AND paid_at<?", t - VEND_TIMEOUT)) vendFailed(o, 'no response from machine');
  run("UPDATE commands SET status='failed', result='timeout' WHERE status IN('queued','sent') AND created_at<?", t - 120000);
  run('DELETE FROM sessions WHERE expires<?', t);
  for (const m of all('SELECT * FROM machines')) {
    if (!m.last_seen) continue;
    if (isOnline(m)) resolveAlert(m.id, 'offline');
    else if (t - m.last_seen > 120000) raiseAlert(m.id, 'offline', 'critical', `Machine offline since ${new Date(m.last_seen + IST).toISOString().slice(11, 16)} IST — check power and network.`);
  }
}, 5000).unref();

// ---------- kiosk service (restock) sessions ----------
const service = new Map();   // token -> { machineId, username, exp }
const pinFails = new Map();  // machineId -> { n, until }
const serviceActive = (machineId) => [...service.values()].some((s) => s.machineId === machineId && s.exp > now());
function serviceAuth(ctx) {
  const s = service.get(ctx.req.headers['x-service-token']);
  if (!s || s.exp < now() || s.machineId !== ctx.machine.id) bad('Service session expired', 401);
  s.exp = now() + 15 * 60000;
  return s;
}
function applyRestock(machineId, items, username) {
  for (const it of items) {
    const s = one('SELECT s.*, p.name pname FROM slots s LEFT JOIN products p ON p.id=s.product_id WHERE s.machine_id=? AND s.code=?', machineId, String(it.code));
    if (!s) continue;
    const qty = Math.max(0, Math.min(s.capacity, Math.round(+it.qty)));
    if (Number.isNaN(qty)) continue;
    run('UPDATE slots SET qty=?, fault=0 WHERE id=?', qty, s.id);
    if (qty !== s.qty) run('INSERT INTO restock_log(machine_id,slot_code,product_name,username,qty_before,qty_after,at) VALUES(?,?,?,?,?,?,?)', machineId, s.code, s.pname, username, s.qty, qty, now());
    resolveAlert(machineId, 'vend_fail_' + s.code);
  }
  checkStock(machineId);
}

// ---------- routing ----------
const routes = [];
const route = (method, pattern, auth, handler) => routes.push({ method, auth, handler, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });
const loginFails = new Map();

function machineView(m) {
  const e = effective(m);
  const s = one('SELECT COALESCE(SUM(qty),0) qty, COALESCE(SUM(capacity),0) cap, COALESCE(SUM(fault),0) faults FROM slots WHERE machine_id=? AND enabled=1 AND product_id IS NOT NULL', m.id);
  const { key_hash, ...rest } = m;
  return { ...rest, online: isOnline(m), state: e.state, lights_on: e.lights, stock_qty: s.qty, stock_cap: s.cap, faults: s.faults,
    open_alerts: one('SELECT COUNT(*) n FROM alerts WHERE machine_id=? AND resolved_at IS NULL', m.id).n };
}
const getMachine = (id) => one('SELECT * FROM machines WHERE id=?', +id) || bad('Machine not found', 404);

// --- auth
route('POST', '/api/login', 'public', (ctx) => {
  const ip = ctx.req.socket.remoteAddress, f = loginFails.get(ip) || { n: 0, until: 0 };
  if (f.until > now()) bad('Too many attempts. Try again in a few minutes.', 429);
  const u = one('SELECT * FROM users WHERE username=?', String(ctx.body.username || ''));
  if (!u || !verifySecret(ctx.body.password || '', u.pass_hash)) {
    f.n++; if (f.n >= 8) { f.until = now() + 10 * 60000; f.n = 0; }
    loginFails.set(ip, f); bad('Wrong username or password', 401);
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', sha256(token), u.id, now() + 12 * 3600000);
  ctx.res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.HTTPS === '1' ? '; Secure' : ''}`);
  return { username: u.username, role: u.role };
});
route('POST', '/api/logout', 'staff', (ctx) => { run('DELETE FROM sessions WHERE user_id=?', ctx.user.id); ctx.res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); return { ok: true }; });
route('GET', '/api/me', 'staff', (ctx) => ({ username: ctx.user.username, role: ctx.user.role, payments: pay.info() }));

// --- overview
route('GET', '/api/overview', 'staff', () => {
  const t0 = startOfIstDay(now());
  const today = one("SELECT COUNT(*) orders, COALESCE(SUM(amount),0) revenue, COALESCE(SUM(amount-cost),0) profit FROM orders WHERE status='completed' AND created_at>=?", t0);
  const week = all("SELECT created_at, amount FROM orders WHERE status='completed' AND created_at>=?", t0 - 13 * DAY);
  const days = {}; for (let i = 13; i >= 0; i--) days[istDate(t0 - i * DAY + 1000)] = 0;
  for (const o of week) days[istDate(o.created_at)] += o.amount;
  return {
    today, trend: Object.entries(days).map(([date, revenue]) => ({ date, revenue })),
    machines: all('SELECT * FROM machines ORDER BY name').map(machineView),
    alerts: all('SELECT a.*, m.name machine FROM alerts a LEFT JOIN machines m ON m.id=a.machine_id WHERE a.resolved_at IS NULL ORDER BY a.created_at DESC LIMIT 20'),
    refund_due: one("SELECT COUNT(*) n FROM orders WHERE status='refund_due'").n,
  };
});

// --- machines
route('GET', '/api/machines', 'staff', () => all('SELECT * FROM machines ORDER BY name').map(machineView));
route('POST', '/api/machines', 'admin', (ctx) => {
  const b = ctx.body, rows = Math.min(8, Math.max(1, +b.rows || 6)), cols = Math.min(10, Math.max(1, +b.cols || 8));
  if (!b.name) bad('Name is required');
  const key = newKey();
  const r = run('INSERT INTO machines(name,location,key_hash,rows,cols,cooled,created_at) VALUES(?,?,?,?,?,?,?)', String(b.name), String(b.location || ''), sha256(key), rows, cols, b.cooled === false ? 0 : 1, now());
  createSlots(Number(r.lastInsertRowid), rows, cols);
  return { id: Number(r.lastInsertRowid), machine_key: key };
});
route('POST', '/api/machines/:id/key', 'admin', (ctx) => { const m = getMachine(ctx.params.id); const key = newKey(); run('UPDATE machines SET key_hash=? WHERE id=?', sha256(key), m.id); return { machine_key: key }; });
route('DELETE', '/api/machines/:id', 'admin', (ctx) => { run('DELETE FROM machines WHERE id=?', getMachine(ctx.params.id).id); return { ok: true }; });
route('POST', '/api/machines/:id/control', 'admin', (ctx) => {
  const m = getMachine(ctx.params.id), b = ctx.body, time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (b.mode !== undefined && !['auto', 'on', 'sleep', 'maintenance'].includes(b.mode)) bad('Invalid mode');
  if (b.lights_mode !== undefined && !['auto', 'on', 'off'].includes(b.lights_mode)) bad('Invalid lights mode');
  for (const k of ['open_time', 'close_time']) if (b[k] !== undefined && !time.test(b[k])) bad('Times must be HH:MM');
  for (const k of ['name', 'location', 'mode', 'sleep_message', 'lights_mode', 'open_time', 'close_time'])
    if (b[k] !== undefined) run(`UPDATE machines SET ${k}=? WHERE id=?`, String(b[k]).slice(0, 300), m.id);
  const w = waiters.get(m.id); if (w) w();   // push the new state to the machine immediately
  return machineView(getMachine(m.id));
});
route('POST', '/api/machines/:id/command', 'admin', (ctx) => {
  const m = getMachine(ctx.params.id), b = ctx.body;
  if (!['unlock', 'test_vend', 'reboot'].includes(b.type)) bad('Unknown command');
  if (!isOnline(m)) bad('Machine is offline', 409);
  let payload = {};
  if (b.type === 'test_vend') {
    const s = one('SELECT * FROM slots WHERE machine_id=? AND code=?', m.id, String(b.slot || '')) || bad('Slot not found', 404);
    payload = { slot: s.code, row: s.row, col: s.col };
  }
  return { command_id: enqueue(m.id, b.type, payload) };
});
route('GET', '/api/commands/:id', 'staff', (ctx) => one('SELECT id,type,status,result FROM commands WHERE id=?', +ctx.params.id) || bad('Not found', 404));

// --- products
route('GET', '/api/products', 'staff', () => all('SELECT * FROM products ORDER BY category, name'));
const productFields = (b) => {
  if (!b.name || !b.category) bad('Name and category are required');
  if (!(+b.price > 0)) bad('Price must be above 0');
  return [String(b.name), String(b.category), +b.price, +b.cost || 0, String(b.emoji || '🍫'), String(b.supplier || ''), b.active === false ? 0 : 1];
};
route('POST', '/api/products', 'admin', (ctx) => ({ id: Number(run('INSERT INTO products(name,category,price,cost,emoji,supplier,active) VALUES(?,?,?,?,?,?,?)', ...productFields(ctx.body)).lastInsertRowid) }));
route('PUT', '/api/products/:id', 'admin', (ctx) => { run('UPDATE products SET name=?,category=?,price=?,cost=?,emoji=?,supplier=?,active=? WHERE id=?', ...productFields(ctx.body), +ctx.params.id); return { ok: true }; });

// --- slots + restock
const slotList = (machineId) => all(
  `SELECT s.id,s.code,s.row,s.col,s.product_id,s.capacity,s.qty,s.enabled,s.fault,p.name product,p.price,p.emoji,p.category
   FROM slots s LEFT JOIN products p ON p.id=s.product_id WHERE s.machine_id=? ORDER BY s.row,s.col`, machineId);
route('GET', '/api/machines/:id/slots', 'staff', (ctx) => slotList(getMachine(ctx.params.id).id));
route('PUT', '/api/slots/:id', 'admin', (ctx) => {
  const s = one('SELECT * FROM slots WHERE id=?', +ctx.params.id) || bad('Slot not found', 404), b = ctx.body;
  const cap = Math.max(1, Math.min(40, Math.round(+(b.capacity ?? s.capacity))));
  const pid = b.product_id === undefined ? s.product_id : (b.product_id ? +b.product_id : null);
  const qty = pid ? Math.max(0, Math.min(cap, Math.round(+(b.qty ?? s.qty)))) : 0;
  run('UPDATE slots SET product_id=?,capacity=?,qty=?,enabled=?,fault=? WHERE id=?', pid, cap, qty, (b.enabled ?? s.enabled) ? 1 : 0, (b.fault ?? s.fault) ? 1 : 0, s.id);
  if (!(b.fault ?? s.fault)) resolveAlert(s.machine_id, 'vend_fail_' + s.code);
  checkStock(s.machine_id);
  return { ok: true };
});
route('POST', '/api/machines/:id/restock', 'staff', (ctx) => {
  const m = getMachine(ctx.params.id);
  const items = ctx.body.fill ? slotList(m.id).filter((s) => s.product_id).map((s) => ({ code: s.code, qty: s.capacity })) : (ctx.body.items || []);
  applyRestock(m.id, items, ctx.user.username);
  return { ok: true, slots: slotList(m.id) };
});
route('GET', '/api/restock-log', 'staff', () => all('SELECT r.*, m.name machine FROM restock_log r JOIN machines m ON m.id=r.machine_id ORDER BY r.at DESC LIMIT 200'));

// --- payments / orders
function orderQuery(q) {
  const w = ['1=1'], p = [];
  if (q.machine) { w.push('o.machine_id=?'); p.push(+q.machine); }
  if (q.status) { w.push('o.status=?'); p.push(q.status); }
  if (q.method) { w.push('o.method=?'); p.push(q.method); }
  if (q.from) { w.push('o.created_at>=?'); p.push(Date.parse(q.from + 'T00:00:00+05:30')); }
  if (q.to) { w.push('o.created_at<?'); p.push(Date.parse(q.to + 'T00:00:00+05:30') + DAY); }
  return { where: w.join(' AND '), p };
}
route('GET', '/api/orders', 'staff', (ctx) => {
  const { where, p } = orderQuery(ctx.query);
  return {
    rows: all(`SELECT o.*, m.name machine FROM orders o JOIN machines m ON m.id=o.machine_id WHERE ${where} ORDER BY o.created_at DESC LIMIT 300`, ...p),
    summary: all(`SELECT o.status, o.method, COUNT(*) n, SUM(o.amount) amount FROM orders o WHERE ${where} GROUP BY o.status, o.method`, ...p),
  };
});
route('GET', '/api/orders.csv', 'staff', (ctx) => {
  const { where, p } = orderQuery(ctx.query);
  const rows = all(`SELECT o.*, m.name machine FROM orders o JOIN machines m ON m.id=o.machine_id WHERE ${where} ORDER BY o.created_at DESC`, ...p);
  const cols = ['id', 'time_ist', 'machine', 'slot_code', 'product_name', 'category', 'amount', 'cost', 'method', 'status', 'provider', 'payment_id', 'refund_ref', 'note'];
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(c === 'time_ist' ? new Date(r.created_at + IST).toISOString().slice(0, 19).replace('T', ' ') : r[c])).join(','))).join('\n');
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="campusvend-payments.csv"' });
  ctx.res.end(csv);
});
route('POST', '/api/orders/:id/refunded', 'admin', (ctx) => {
  const r = run("UPDATE orders SET status='refunded', refund_ref=? WHERE id=? AND status='refund_due'", 'manual:' + ctx.user.username, +ctx.params.id);
  if (!r.changes) bad('Order is not awaiting a refund', 409);
  if (!one("SELECT id FROM orders WHERE status='refund_due' LIMIT 1")) for (const m of all('SELECT id FROM machines')) resolveAlert(m.id, 'refund_due');
  return { ok: true };
});

// --- analytics + forecast
route('GET', '/api/analytics', 'staff', (ctx) => {
  const days = Math.min(180, Math.max(1, +ctx.query.days || 30)), t0 = startOfIstDay(now()) - (days - 1) * DAY;
  const p = [t0]; let w = '';
  if (ctx.query.machine) { w = ' AND o.machine_id=?'; p.push(+ctx.query.machine); }
  const rows = all(`SELECT o.created_at,o.amount,o.cost,o.method,o.category,o.product_name,m.name machine FROM orders o JOIN machines m ON m.id=o.machine_id WHERE o.status='completed' AND o.created_at>=?${w}`, ...p);
  const byDay = {}; for (let i = 0; i < days; i++) byDay[istDate(t0 + i * DAY + 1000)] = { revenue: 0, orders: 0, profit: 0 };
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
  const cat = {}, mach = {}, prod = {}, method = {};
  const bump = (o, k, r) => { o[k] ??= { revenue: 0, orders: 0, profit: 0 }; o[k].revenue += r.amount; o[k].orders++; o[k].profit += r.amount - r.cost; };
  const tot = { revenue: 0, orders: 0, profit: 0 };
  for (const r of rows) {
    const d = byDay[istDate(r.created_at)]; if (d) { d.revenue += r.amount; d.orders++; d.profit += r.amount - r.cost; }
    const h = byHour[istHour(r.created_at)]; h.orders++; h.revenue += r.amount;
    bump(cat, r.category, r); bump(mach, r.machine, r); bump(prod, r.product_name, r); bump(method, r.method, r);
    tot.revenue += r.amount; tot.orders++; tot.profit += r.amount - r.cost;
  }
  const list = (o) => Object.entries(o).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  const failed = one(`SELECT COUNT(*) n FROM orders o WHERE o.status IN('refund_due','refunded') AND o.created_at>=?${w}`, ...p).n;
  return { days, totals: { ...tot, avg_ticket: tot.orders ? tot.revenue / tot.orders : 0, failed_vends: failed },
    by_day: Object.entries(byDay).map(([date, v]) => ({ date, ...v })), by_hour: byHour,
    by_category: list(cat), by_machine: list(mach), by_method: list(method), top_products: list(prod).slice(0, 10) };
});
route('GET', '/api/forecast', 'staff', (ctx) => forecast(ctx.query.machine ? +ctx.query.machine : null, Math.min(30, Math.max(1, +ctx.query.horizon || 7))));

// --- alerts
route('GET', '/api/alerts', 'staff', () => all('SELECT a.*, m.name machine FROM alerts a LEFT JOIN machines m ON m.id=a.machine_id ORDER BY a.resolved_at IS NOT NULL, a.created_at DESC LIMIT 200'));
route('POST', '/api/alerts/:id/resolve', 'staff', (ctx) => { run('UPDATE alerts SET resolved_at=? WHERE id=? AND resolved_at IS NULL', now(), +ctx.params.id); return { ok: true }; });

// --- settings + users
route('GET', '/api/settings', 'admin', () => {
  const s = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, getSetting(k)]));
  s.telegram_token = s.telegram_token ? '••••' + s.telegram_token.slice(-4) : '';
  return s;
});
route('PUT', '/api/settings', 'admin', (ctx) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = ctx.body[k]; if (v === undefined) continue;
    if (k === 'telegram_token' && String(v).startsWith('••••')) continue;   // unchanged masked value
    if (k === 'webhook_url' && v && !/^https:\/\//.test(v)) bad('Webhook URL must start with https://');
    setSetting(k, String(v).slice(0, 500));
  }
  return { ok: true };
});
route('POST', '/api/settings/test-notify', 'admin', async () => { await notify('✅ CampusVend test notification — alerts are working.'); return { ok: true }; });
route('GET', '/api/users', 'admin', () => all('SELECT id,username,role,pin_hash IS NOT NULL has_pin FROM users ORDER BY username'));
const checkPw = (p) => { if (String(p || '').length < 8) bad('Password must be at least 8 characters'); return hashSecret(p); };
const checkPin = (p) => { if (!/^\d{6}$/.test(String(p))) bad('Service PIN must be exactly 6 digits'); return hashSecret(p); };
route('POST', '/api/users', 'admin', (ctx) => {
  const b = ctx.body;
  if (!/^[a-z0-9_.-]{3,30}$/i.test(b.username || '')) bad('Username: 3-30 letters, numbers, . _ -');
  if (!['admin', 'restocker'].includes(b.role)) bad('Role must be admin or restocker');
  if (one('SELECT id FROM users WHERE username=?', b.username)) bad('Username already exists', 409);
  run('INSERT INTO users(username,pass_hash,role,pin_hash,created_at) VALUES(?,?,?,?,?)', b.username, checkPw(b.password), b.role, b.pin ? checkPin(b.pin) : null, now());
  return { ok: true };
});
route('PUT', '/api/users/:id', 'admin', (ctx) => {
  const u = one('SELECT * FROM users WHERE id=?', +ctx.params.id) || bad('User not found', 404), b = ctx.body;
  if (b.password) { run('UPDATE users SET pass_hash=? WHERE id=?', checkPw(b.password), u.id); run('DELETE FROM sessions WHERE user_id=? AND user_id<>?', u.id, ctx.user.id); }
  if (b.pin) run('UPDATE users SET pin_hash=? WHERE id=?', checkPin(b.pin), u.id);
  return { ok: true };
});
route('DELETE', '/api/users/:id', 'admin', (ctx) => {
  if (+ctx.params.id === ctx.user.id) bad('You cannot delete your own account');
  run('DELETE FROM sessions WHERE user_id=?', +ctx.params.id); run('DELETE FROM users WHERE id=?', +ctx.params.id);
  return { ok: true };
});

// ---------- machine agent API ----------
route('POST', '/api/agent/sync', 'machine', async (ctx) => {
  const m = ctx.machine, b = ctx.body, t = b.telemetry || {};
  for (const r of b.results || []) vendResult(m.id, r);
  run('UPDATE machines SET last_seen=?, temp_c=?, door_open=?, fw=?, controller_ok=? WHERE id=?', now(),
    typeof t.temp_c === 'number' ? t.temp_c : null, t.door_open ? 1 : 0, String(t.fw || '').slice(0, 40), t.controller_ok === false ? 0 : 1, m.id);
  resolveAlert(m.id, 'offline');
  if (t.controller_ok === false) raiseAlert(m.id, 'controller', 'critical', 'Motor controller board is not responding (USB/serial). Machine cannot vend.'); else resolveAlert(m.id, 'controller');
  if (m.cooled && typeof t.temp_c === 'number' && t.temp_c > (+getSetting('temp_max_c') || 14)) raiseAlert(m.id, 'temperature', 'warning', `Cabinet temperature is ${t.temp_c.toFixed(1)} °C — check cooling unit and door seal.`);
  else if (typeof t.temp_c === 'number') resolveAlert(m.id, 'temperature');
  if (t.door_open && !serviceActive(m.id)) raiseAlert(m.id, 'door_open', 'critical', 'Door is open without a service login — possible tampering.'); else if (!t.door_open) resolveAlert(m.id, 'door_open');
  if (t.tilt) raiseAlert(m.id, 'tilt', 'critical', 'Tilt / vibration sensor triggered — machine is being shaken or moved.');

  let cmds = takeCommands(m.id);
  if (!cmds.length && b.wait) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 20000);
      waiters.set(m.id, () => { clearTimeout(timer); resolve(); });
      ctx.req.on('close', () => { clearTimeout(timer); resolve(); });
    });
    waiters.delete(m.id);
    cmds = takeCommands(m.id);
  }
  const e = effective(getMachine(m.id));
  return { desired: { lights: e.lights, state: e.state }, commands: cmds };
});

// ---------- kiosk API ----------
route('GET', '/api/kiosk/state', 'machine', (ctx) => {
  const m = ctx.machine, e = effective(m);
  return {
    machine: { name: m.name, location: m.location, state: isOnline(m) ? e.state : 'offline', message: e.message, campus: getSetting('campus_name') },
    payments: { ...pay.info(), card_enabled: pay.cardEnabled() },
    slots: slotList(m.id).filter((s) => s.product_id && s.enabled).map((s) => ({ code: s.code, product: s.product, price: s.price, emoji: s.emoji, category: s.category, available: s.qty > 0 && !s.fault })),
  };
});
route('POST', '/api/kiosk/order', 'machine', async (ctx) => {
  const m = ctx.machine, method = ctx.body.method === 'card' ? 'card' : 'upi';
  if (effective(m).state !== 'active') bad('Machine is not accepting orders right now', 409);
  if (!isOnline(m)) bad('Machine is temporarily unavailable', 409);
  if (method === 'card' && !pay.cardEnabled()) bad('Card payments are not available on this machine', 409);
  if (one("SELECT id FROM orders WHERE machine_id=? AND status IN('vending')", m.id)) bad('Please wait — the machine is dispensing', 409);
  const s = one('SELECT s.*, p.name pname, p.price, p.cost, p.category FROM slots s JOIN products p ON p.id=s.product_id WHERE s.machine_id=? AND s.code=? AND s.enabled=1', m.id, String(ctx.body.slot || '')) || bad('Item not found', 404);
  if (s.qty < 1 || s.fault) bad('Sorry, this item is sold out', 409);
  run("UPDATE orders SET status='cancelled' WHERE machine_id=? AND status='pending'", m.id);
  const id = Number(run("INSERT INTO orders(machine_id,slot_id,slot_code,product_id,product_name,category,amount,cost,method,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)",
    m.id, s.id, s.code, s.product_id, s.pname, s.category, s.price, s.cost, method, now()).lastInsertRowid);
  const order = one('SELECT * FROM orders WHERE id=?', id);
  try {
    const p = await pay.create(order, m, ORDER_TTL);
    run('UPDATE orders SET provider=?, provider_ref=? WHERE id=?', p.provider, p.ref, id);
    return { id, amount: order.amount, product: s.pname, method, qr_image: p.qr_image || null, demo: !!p.demo, expires_in: ORDER_TTL / 1000 };
  } catch (e) {
    run("UPDATE orders SET status='cancelled', note=? WHERE id=?", String(e.message).slice(0, 200), id);
    raiseAlert(m.id, 'payment_gateway', 'warning', 'Payment gateway error: ' + e.message);
    bad('Payment service is unavailable. Please try again.', 502);
  }
});
const kioskOrder = (ctx) => one('SELECT * FROM orders WHERE id=? AND machine_id=?', +ctx.params.id, ctx.machine.id) || bad('Order not found', 404);
const lastCheck = new Map();
route('GET', '/api/kiosk/order/:id', 'machine', async (ctx) => {
  let o = kioskOrder(ctx);
  if (o.status === 'pending' && o.provider !== 'mock' && now() - (lastCheck.get(o.id) || 0) > 3000) {
    lastCheck.set(o.id, now());
    try { const r = await pay.check(o); if (r.paid) { markPaid(o.id, r.payment_id); resolveAlert(o.machine_id, 'payment_gateway'); o = kioskOrder(ctx); } } catch (e) { console.warn('[pay] check failed:', e.message); }
  }
  return { id: o.id, status: o.status };
});
route('POST', '/api/kiosk/order/:id/cancel', 'machine', async (ctx) => {
  const o = kioskOrder(ctx);
  if (o.status === 'pending') { run("UPDATE orders SET status='cancelled' WHERE id=?", o.id); await pay.cancel(o); }
  return { ok: true };
});
route('POST', '/api/kiosk/order/:id/demo-pay', 'machine', (ctx) => {
  const o = kioskOrder(ctx);
  if (o.provider !== 'mock') bad('Not a demo order', 403);
  markPaid(o.id, 'demo_' + o.id);
  return { ok: true };
});
route('POST', '/api/kiosk/service/login', 'machine', (ctx) => {
  const m = ctx.machine, f = pinFails.get(m.id) || { n: 0, until: 0 };
  if (f.until > now()) bad('Too many wrong PINs. Locked for 5 minutes.', 429);
  const u = all('SELECT * FROM users WHERE pin_hash IS NOT NULL').find((x) => verifySecret(ctx.body.pin || '', x.pin_hash));
  if (!u) {
    f.n++;
    if (f.n >= 5) { f.until = now() + 5 * 60000; f.n = 0; raiseAlert(m.id, 'pin_lockout', 'warning', '5 wrong service PIN attempts at the kiosk.'); }
    pinFails.set(m.id, f); bad('Wrong PIN', 401);
  }
  pinFails.delete(m.id);
  const token = crypto.randomBytes(24).toString('base64url');
  service.set(token, { machineId: m.id, username: u.username, exp: now() + 15 * 60000 });
  return { token, username: u.username, slots: slotList(m.id) };
});
route('POST', '/api/kiosk/service/unlock', 'machine', (ctx) => { serviceAuth(ctx); return { command_id: enqueue(ctx.machine.id, 'unlock') }; });
route('POST', '/api/kiosk/service/restock', 'machine', (ctx) => { const s = serviceAuth(ctx); applyRestock(ctx.machine.id, ctx.body.items || [], s.username); return { slots: slotList(ctx.machine.id) }; });
route('POST', '/api/kiosk/service/logout', 'machine', (ctx) => { service.delete(ctx.req.headers['x-service-token']); return { ok: true }; });

// ---------- payment webhook ----------
route('POST', '/api/webhooks/razorpay', 'public', (ctx) => {
  const ev = pay.parseWebhook(ctx.raw, ctx.req.headers['x-razorpay-signature']);
  if (!ev) bad('Bad signature', 400);
  if (ev.qr_id) { const o = one("SELECT id FROM orders WHERE provider='razorpay' AND provider_ref=?", ev.qr_id); if (o) markPaid(o.id, ev.payment_id); }
  return { ok: true };
});

// ---------- http server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const PUBLIC = path.join(__dirname, 'public');
function serveStatic(req, res, pathname) {
  if (pathname === '/') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(file).pipe(res);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 262144) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
function authenticate(ctx, level) {
  if (level === 'public') return;
  if (level === 'machine') {
    const key = ctx.req.headers['x-machine-key'];
    ctx.machine = key && one('SELECT * FROM machines WHERE key_hash=?', sha256(key));
    if (!ctx.machine) bad('Invalid machine key', 401);
    return;
  }
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(ctx.req.headers.cookie || '')?.[1];
  const s = sid && one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?', sha256(sid), now());
  if (!s) bad('Please log in', 401);
  if (level === 'admin' && s.role !== 'admin') bad('Admin access required', 403);
  if (ctx.req.method !== 'GET' && !(ctx.req.headers['content-type'] || '').includes('application/json')) bad('JSON required', 415);
  ctx.user = s;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname); if (!m) continue;
      const ctx = { req, res, params: m.groups || {}, query: Object.fromEntries(url.searchParams), body: {} };
      if (req.method !== 'GET') {
        ctx.raw = await readBody(req);
        if (ctx.raw.length) { try { ctx.body = JSON.parse(ctx.raw.toString('utf8')) || {}; } catch { bad('Invalid JSON'); } }
      }
      authenticate(ctx, r.auth);
      const out = await r.handler(ctx);
      if (!res.writableEnded && !res.headersSent) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(out ?? {})); }
      return;
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error('[error]', req.method, url.pathname, e);
    if (!res.headersSent) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Server error' })); }
  }
}).listen(PORT, () => {
  const p = pay.info();
  console.log(`CampusVend server on http://localhost:${PORT}  (admin: /admin/  kiosk: /kiosk/)`);
  console.log(`Payments: UPI=${p.upi} card=${p.card}${p.demo ? '  ** DEMO MODE — no real money is collected **' : ''}`);
});
