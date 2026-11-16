'use strict';
/*
 * Card / NFC tap-to-pay adapter — TEMPLATE. Not functional until you fill it in.
 *
 * Debit/credit contactless payments must go through a bank-certified (PCI-PTS / EMV L1+L2)
 * terminal supplied by your acquirer (for example Pine Labs, Razorpay POS, Paytm, PhonePe, or
 * your bank's EDC machine). A hobby NFC module (PN532 / RC522) cannot legally or technically
 * accept bank cards.
 *
 * Every acquirer gives merchants a "cloud / push-to-terminal" API after onboarding:
 *   1. server -> acquirer : "collect Rs X on terminal <id>, reference <order id>"
 *   2. customer taps card on the terminal fitted in the machine fascia
 *   3. server polls (or receives webhook) for the result
 * Fill the three functions below using the API document your acquirer gives you, then start the
 * server with CARD_PROVIDER=edc. Put the per-machine terminal id in EDC_TERMINALS, e.g.
 *   EDC_TERMINALS='{"1":"TID0001","2":"TID0002"}'   (machine id -> terminal id)
 */
const terminals = JSON.parse(process.env.EDC_TERMINALS || '{}');
const notReady = () => { throw new Error('Card terminal adapter (server/lib/card-edc.js) is not configured yet'); };

module.exports = {
  // Must return { ref } — the acquirer's transaction/request id.
  async startCharge(order, machine) {
    const terminalId = terminals[machine.id];
    void terminalId; void order;
    return notReady();
  },
  // Must return { paid: true, payment_id } once approved, else { paid: false }.
  async checkCharge(order) { void order; return notReady(); },
  async cancelCharge(order) { void order; },
  // Must return { ok: true, ref } when the reversal/refund was accepted.
  async refundCharge(order) { void order; return { ok: false }; },
};
