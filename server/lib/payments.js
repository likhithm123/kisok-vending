'use strict';
/*
 * Payment providers.
 *
 *  UPI QR  : PAYMENT_PROVIDER=mock      -> demo mode, "Simulate payment" button on kiosk (no real money)
 *            PAYMENT_PROVIDER=razorpay  -> dynamic single-use UPI QR via Razorpay QR Codes API
 *                                          needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *  Card/NFC: CARD_PROVIDER=none (default) | mock | edc
 *            "edc" loads ./card-edc.js — the adapter for your bank-certified tap-to-pay terminal.
 *
 * Card data never touches this software: tap/chip/PIN happen inside the certified terminal.
 */
const crypto = require('crypto');

const UPI = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
const CARD = (process.env.CARD_PROVIDER || (UPI === 'mock' ? 'mock' : 'none')).toLowerCase();
const RZP = 'https://api.razorpay.com/v1';

async function rzp(method, url, body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch(RZP + url, {
    method, headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Razorpay ${r.status}: ${j?.error?.description || 'request failed'}`);
  return j;
}

let cardAdapter = null;
function edc() {
  if (!cardAdapter) cardAdapter = require('./card-edc');
  return cardAdapter;
}

module.exports = {
  info: () => ({ upi: UPI, card: CARD, demo: UPI === 'mock' }),
  cardEnabled: () => CARD !== 'none',

  // Start a payment. Returns { provider, ref, qr_image?, demo? }
  async create(order, machine, ttlMs) {
    if (order.method === 'card') {
      if (CARD === 'mock') return { provider: 'mock', ref: 'mockcard_' + order.id, demo: true };
      if (CARD === 'edc') { const r = await edc().startCharge(order, machine); return { provider: 'edc', ref: r.ref }; }
      throw new Error('Card payments are not enabled');
    }
    if (UPI === 'mock') return { provider: 'mock', ref: 'mockqr_' + order.id, demo: true };
    if (UPI === 'razorpay') {
      const qr = await rzp('POST', '/payments/qr_codes', {
        type: 'upi_qr', name: `CampusVend ${machine.name}`.slice(0, 40), usage: 'single_use', fixed_amount: true,
        payment_amount: Math.round(order.amount * 100), description: `Order ${order.id} ${order.product_name}`.slice(0, 80),
        close_by: Math.floor((Date.now() + Math.max(ttlMs, 130000)) / 1000),
        notes: { order_id: String(order.id), machine: machine.name },
      });
      return { provider: 'razorpay', ref: qr.id, qr_image: qr.image_url };
    }
    throw new Error('Unknown PAYMENT_PROVIDER ' + UPI);
  },

  // Poll fallback (used when webhooks can't reach a campus-LAN server). Returns { paid, payment_id }
  async check(order) {
    if (order.provider === 'razorpay') {
      const r = await rzp('GET', `/payments/qr_codes/${order.provider_ref}/payments`);
      const p = (r.items || []).find((x) => x.status === 'captured');
      return p ? { paid: true, payment_id: p.id } : { paid: false };
    }
    if (order.provider === 'edc') return edc().checkCharge(order);
    return { paid: false };
  },

  async cancel(order) {
    try {
      if (order.provider === 'razorpay') await rzp('POST', `/payments/qr_codes/${order.provider_ref}/close`);
      if (order.provider === 'edc') await edc().cancelCharge(order);
    } catch (e) { console.warn('[pay] cancel failed:', e.message); }
  },

  // Returns { ok, ref } — when ok is false the order stays "refund_due" for manual handling.
  async refund(order) {
    try {
      if (order.provider === 'mock' || order.provider === 'demo') return { ok: true, ref: 'mockrefund_' + order.id };
      if (order.provider === 'razorpay' && order.payment_id) {
        const r = await rzp('POST', `/payments/${order.payment_id}/refund`, { amount: Math.round(order.amount * 100), speed: 'normal' });
        return { ok: true, ref: r.id };
      }
      if (order.provider === 'edc') return await edc().refundCharge(order);
    } catch (e) { console.warn('[pay] refund failed:', e.message); }
    return { ok: false };
  },

  // Razorpay webhook: verify signature, return { qr_id, payment_id } for a credited QR, else null.
  parseWebhook(raw, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return null;
    const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(want), b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const ev = JSON.parse(raw.toString('utf8'));
    if (ev.event !== 'qr_code.credited') return {};
    return { qr_id: ev.payload?.qr_code?.entity?.id, payment_id: ev.payload?.payment?.entity?.id };
  },
};
