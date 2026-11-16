'use strict';
/*
 * Demo data: 5 VIT machines, a product catalogue, 45 days of SIMULATED sales.
 * Run once:  node seed.js     (wipe with: rm -rf data && node seed.js)
 * Sales created here are synthetic (provider = "demo") — they exist only so the
 * dashboards, forecast and analytics have something to show before real data arrives.
 */
const fs = require('fs');
const path = require('path');
const { one, run, now, sha256, newKey, createSlots, ensureAdmin, hashSecret, db, DATA_DIR } = require('./db');

if (one('SELECT id FROM machines LIMIT 1')) { console.log('Database already has machines — seed skipped.'); process.exit(0); }
ensureAdmin();

const DAY = 86400000, IST = 5.5 * 3600000;
// name, category, MRP, landed cost, emoji, supplier
const PRODUCTS = [
  ['Lays Classic Salted 52g', 'Snacks', 20, 16.4, '🥔', 'Campus store A'], ['Kurkure Masala Munch 75g', 'Snacks', 20, 16.4, '🌶️', 'Campus store A'],
  ['Bingo Mad Angles 66g', 'Snacks', 20, 16.2, '🔺', 'Campus store A'], ['Haldiram Aloo Bhujia 40g', 'Snacks', 10, 8.1, '🥨', 'Campus store A'],
  ['Act II Popcorn 60g', 'Snacks', 30, 23.5, '🍿', 'Campus store A'], ['Roasted Peanuts 50g', 'Snacks', 20, 15.5, '🥜', 'Campus store A'],
  ['Good Day Butter 75g', 'Biscuits', 10, 8.3, '🍪', 'Campus store B'], ['Hide & Seek 100g', 'Biscuits', 30, 24.6, '🍪', 'Campus store B'],
  ['Oreo Vanilla 120g', 'Biscuits', 40, 32.5, '⚫', 'Campus store B'], ['Bourbon 60g', 'Biscuits', 10, 8.3, '🟫', 'Campus store B'],
  ['Marie Gold 75g', 'Biscuits', 10, 8.4, '🥠', 'Campus store B'], ['Dark Fantasy Choco Fills', 'Biscuits', 40, 32.0, '🍩', 'Campus store B'],
  ['Dairy Milk 23g', 'Chocolates', 20, 16.8, '🍫', 'Campus store B'], ['5 Star 40g', 'Chocolates', 20, 16.8, '⭐', 'Campus store B'],
  ['KitKat 4 Finger', 'Chocolates', 30, 25.2, '🍫', 'Campus store B'], ['Snickers 45g', 'Chocolates', 50, 41.0, '🥜', 'Campus store B'],
  ['Munch Max 38g', 'Chocolates', 20, 16.8, '🍫', 'Campus store B'],
  ['Real Mixed Fruit 180ml', 'Juices', 20, 16.0, '🧃', 'Juice vendor'], ['Frooti 150ml', 'Juices', 10, 8.0, '🥭', 'Juice vendor'],
  ['Paper Boat Aamras 200ml', 'Juices', 30, 23.5, '🥭', 'Juice vendor'], ['Tropicana Orange 200ml', 'Juices', 25, 20.0, '🍊', 'Juice vendor'],
  ['Amul Kool Badam 180ml', 'Juices', 25, 20.5, '🥛', 'Juice vendor'], ['Water 500ml', 'Juices', 10, 6.5, '💧', 'Juice vendor'],
  ['RiteBite Max Protein 67g', 'Protein bars', 80, 58, '💪', 'Nutrition distributor'], ['Yoga Bar Protein 60g', 'Protein bars', 125, 92, '💪', 'Nutrition distributor'],
  ['Whole Truth Protein 52g', 'Protein bars', 110, 82, '💪', 'Nutrition distributor'], ['Max Protein Daily 50g', 'Protein bars', 50, 37, '💪', 'Nutrition distributor'],
];
// name, location, open, close, daily orders (simulated), hourly demand shape
const night = [9, 7, 4, 2, 1, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 9, 10];
const dayT = [0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 8, 9, 6, 7, 6, 7, 9, 8, 5, 3, 0, 0, 0, 0];
const MACHINES = [
  ['SMV Ground Floor', 'SMV academic block — no shop nearby', '08:00', '20:00', 75, dayT, 'This machine is resting. See you during class hours!'],
  ['MB Lobby', 'Main Building — no shop nearby', '08:00', '20:00', 85, dayT, 'This machine is resting. See you during class hours!'],
  ['SJT CDC Office', 'SJT — Career Development Centre (shops far away)', '08:00', '20:00', 60, dayT, 'This machine is resting. See you during office hours!'],
  ["Men's Hostel Q Block", 'Hostel — runs only after shops and canteen close', '21:00', '07:00', 130, night, 'The canteen is open now — this machine wakes up when it closes.'],
  ["Ladies' Hostel H Block", 'Hostel — runs only after shops and canteen close', '21:00', '07:00', 100, night, 'The canteen is open now — this machine wakes up when it closes.'],
];

db.exec('BEGIN');
const pid = PRODUCTS.map((p) => Number(run('INSERT INTO products(name,category,price,cost,emoji,supplier) VALUES(?,?,?,?,?,?)', ...p).lastInsertRowid));
const popularity = PRODUCTS.map((p) => ({ Snacks: 1.3, Biscuits: 1.0, Chocolates: 1.1, Juices: 1.4, 'Protein bars': 0.35 }[p[1]]));
const keys = {};
let seedN = 42; const rnd = () => (seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296;
const today0 = Math.floor((now() + IST) / DAY) * DAY - IST;

MACHINES.forEach(([name, location, open, close, perDay, shape, msg], mi) => {
  const key = newKey(); keys[name] = key;
  const mid = Number(run('INSERT INTO machines(name,location,key_hash,open_time,close_time,sleep_message,created_at) VALUES(?,?,?,?,?,?,?)', name, location, sha256(key), open, close, msg, now()).lastInsertRowid);
  createSlots(mid, 6, 8);
  // planogram: rows A-B snacks, C biscuits, D chocolates, E juices, F protein bars + extra juices
  const plan = [[0, 1, 2, 3, 4, 5, 0, 1], [0, 1, 2, 5, 4, 3, 2, 0], [6, 7, 8, 9, 10, 11, 6, 9], [12, 13, 14, 15, 16, 12, 13, 14], [17, 18, 19, 20, 21, 22, 22, 18], [23, 24, 25, 26, 23, 26, 17, 22]];
  const slotsOf = {};
  plan.forEach((rowP, r) => rowP.forEach((pi, c) => {
    const code = String.fromCharCode(65 + r) + (c + 1), cap = r === 4 ? 8 : 10;
    const qty = Math.max(0, Math.round(cap * (0.15 + rnd() * 0.85)) - (rnd() < 0.08 ? cap : 0));
    run('UPDATE slots SET product_id=?, capacity=?, qty=? WHERE machine_id=? AND code=?', pid[pi], cap, qty, mid, code);
    (slotsOf[pi] ??= []).push(code);
  }));
  const items = Object.keys(slotsOf).map(Number), weights = items.map((i) => popularity[i] * slotsOf[i].length);
  const wSum = weights.reduce((a, b) => a + b, 0), sSum = shape.reduce((a, b) => a + b, 0);
  for (let d = 45; d >= 0; d--) {
    const dayStart = today0 - d * DAY, dow = new Date(dayStart + IST).getUTCDay();
    const growth = 0.7 + 0.3 * (45 - d) / 45, weekend = mi < 3 ? (dow === 0 ? 0.25 : dow === 6 ? 0.6 : 1) : (dow === 0 || dow === 6 ? 1.15 : 1);
    const n = Math.round(perDay * growth * weekend * (0.85 + rnd() * 0.3));
    for (let k = 0; k < n; k++) {
      let x = rnd() * sSum, h = 0; while ((x -= shape[h]) > 0) h++;
      const at = dayStart + h * 3600000 + Math.floor(rnd() * 3600000);
      if (at > now()) continue;
      let y = rnd() * wSum, ii = 0; while ((y -= weights[ii]) > 0) ii++;
      const pi = items[ii], p = PRODUCTS[pi], code = slotsOf[pi][Math.floor(rnd() * slotsOf[pi].length)];
      run("INSERT INTO orders(machine_id,slot_code,product_id,product_name,category,amount,cost,method,status,provider,created_at,paid_at,completed_at) VALUES(?,?,?,?,?,?,?,?,'completed','demo',?,?,?)",
        mid, code, pid[pi], p[0], p[1], p[2], p[3], rnd() < 0.86 ? 'upi' : 'card', at, at + 20000, at + 28000);
    }
  }
});
// A restocker account for the kiosk service menu, with a random 6-digit PIN.
const pin = String(100000 + Math.floor(Math.random() * 900000));
const rpw = newKey().slice(0, 12);
run('INSERT INTO users(username,pass_hash,role,pin_hash,created_at) VALUES(?,?,?,?,?)', 'restocker', hashSecret(rpw), 'restocker', hashSecret(pin), now());
db.exec('COMMIT');

const out = path.join(DATA_DIR, 'demo-credentials.json');
fs.writeFileSync(out, JSON.stringify({ note: 'Demo credentials. Regenerate machine keys in the admin portal before going live.', machine_keys: keys, restocker: { username: 'restocker', password: rpw, service_pin: pin } }, null, 2), { mode: 0o600 });
console.log(`Seeded ${MACHINES.length} machines, ${PRODUCTS.length} products and 45 days of simulated sales.`);
console.log(`Machine keys + restocker PIN saved in ${out}`);
