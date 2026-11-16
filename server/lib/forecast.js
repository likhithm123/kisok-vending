'use strict';
// Demand forecast: weighted moving average of the last 28 days of completed sales
// (last 7 days weigh 60%, the 21 days before weigh 40%) per machine + product.
const { all, now } = require('../db');
const DAY = 86400000;

function forecast(machineId, horizon = 7) {
  const t = now(), since = t - 28 * DAY;
  const sales = all(
    `SELECT machine_id, product_id, created_at FROM orders
     WHERE status='completed' AND created_at>=? ${machineId ? 'AND machine_id=?' : ''}`,
    ...(machineId ? [since, machineId] : [since]));
  const first = new Map(); // machine -> first sale in window
  const agg = new Map();   // machine|product -> {last7, prev}
  for (const s of sales) {
    if (!first.has(s.machine_id) || s.created_at < first.get(s.machine_id)) first.set(s.machine_id, s.created_at);
    const k = s.machine_id + '|' + s.product_id;
    const a = agg.get(k) || { last7: 0, prev: 0 };
    if (s.created_at >= t - 7 * DAY) a.last7++; else a.prev++;
    agg.set(k, a);
  }
  const slots = all(
    `SELECT s.machine_id, m.name AS machine, s.product_id, p.name AS product, p.category, p.cost, p.supplier,
            SUM(s.qty) AS qty, SUM(s.capacity) AS capacity, COUNT(*) AS slots
     FROM slots s JOIN products p ON p.id=s.product_id JOIN machines m ON m.id=s.machine_id
     WHERE s.enabled=1 ${machineId ? 'AND s.machine_id=?' : ''}
     GROUP BY s.machine_id, s.product_id ORDER BY m.name, p.name`, ...(machineId ? [machineId] : []));

  const rows = slots.map((s) => {
    const a = agg.get(s.machine_id + '|' + s.product_id) || { last7: 0, prev: 0 };
    const hist = Math.max(1, Math.min(28, Math.ceil((t - (first.get(s.machine_id) || t)) / DAY)));
    const rate = hist <= 7 ? (a.last7 + a.prev) / hist : 0.6 * (a.last7 / 7) + 0.4 * (a.prev / (hist - 7));
    const daysLeft = rate > 0 ? s.qty / rate : null;
    const need = Math.max(0, Math.ceil(rate * horizon - s.qty));
    return {
      machine_id: s.machine_id, machine: s.machine, product_id: s.product_id, product: s.product, category: s.category,
      supplier: s.supplier, qty: s.qty, capacity: s.capacity, per_day: +rate.toFixed(2),
      days_left: daysLeft === null ? null : +daysLeft.toFixed(1),
      refill_now: s.capacity - s.qty, need_horizon: need, cost: s.cost,
      status: s.qty === 0 ? 'empty' : daysLeft !== null && daysLeft < 1 ? 'critical' : daysLeft !== null && daysLeft < 2 ? 'soon' : 'ok',
    };
  });

  const buy = new Map();
  for (const r of rows) {
    const b = buy.get(r.product_id) || { product: r.product, category: r.category, supplier: r.supplier, per_day: 0, in_machines: 0, demand: 0, units: 0, cost: r.cost };
    b.per_day += r.per_day; b.in_machines += r.qty; b.demand += r.per_day * horizon; b.units += r.need_horizon;
    buy.set(r.product_id, b);
  }
  const purchase = [...buy.values()].map((b) => ({ ...b, per_day: +b.per_day.toFixed(1), demand: Math.ceil(b.demand), value: +(b.units * b.cost).toFixed(0) }))
    .sort((x, y) => y.units - x.units);
  return { horizon, rows, purchase };
}

module.exports = { forecast };
