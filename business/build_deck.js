// Builds CampusVend_VIT_Proposal.pptx.  Run:  node build_deck.js
// Every financial number on the slides is computed from the ASSUMPTIONS block below — change them and rebuild.
const path = require('path');
const pptxgen = require('pptxgenjs');
const SKILL = process.env.PPTX_SKILL_DIR;
const applyTheme = SKILL ? require(path.join(SKILL, 'scripts/apply_theme.js')).applyTheme : null;

// ---------------- ASSUMPTIONS (estimates — validate in the pilot) ----------------
const A = {
  machines: 5, academic: 3, hostel: 2,
  capexPerMachine: 160000, setupOneTime: 60000,        // install, spares, deposits, signage
  days: 280,                                           // selling days a year (semesters + exams)
  fixed: { 'Restocking staff': 28800, 'Electricity': 11500, 'Maintenance + spares': 6400, 'Card terminal rental': 6000, 'Server + software': 2400 },
  payFee: 0.015, shrink: 0.01,
  scen: {
    Conservative: { orders: 85, ticket: 24, margin: 0.21, vit: 0.05 },
    Base: { orders: 130, ticket: 28, margin: 0.24, vit: 0.05 },
    Optimistic: { orders: 180, ticket: 30, margin: 0.26, vit: 0.05 },
  },
};
const fixedTotal = Object.values(A.fixed).reduce((a, b) => a + b, 0);
function model(s) {
  const rev = s.orders * s.ticket * A.days, gm = rev * s.margin, vit = rev * s.vit, fee = rev * A.payFee, shr = rev * A.shrink;
  const net = gm - vit - fee - shr - fixedTotal;
  const fleetCapex = A.machines * A.capexPerMachine + A.setupOneTime;
  return { rev, gm, vit, fee, shr, net, fleetNet: net * A.machines, fleetCapex, payback: net > 0 ? fleetCapex / (net * A.machines) * 12 : null };
}
const M = Object.fromEntries(Object.entries(A.scen).map(([k, s]) => [k, model(s)]));
const B = M.Base, bs = A.scen.Base;
const contrib = bs.ticket * (bs.margin - bs.vit - A.payFee - A.shrink);
const beOpex = Math.ceil(fixedTotal / (contrib * A.days));
const be24 = Math.ceil((fixedTotal + (A.capexPerMachine + A.setupOneTime / A.machines) / 2) / (contrib * A.days));
const L = (n) => '₹' + (n / 100000).toFixed(n >= 1000000 ? 1 : 2) + ' L';
const K = (n) => '₹' + Math.round(n / 1000) + 'k';
const mo = (m) => (m === null ? 'No payback' : m > 60 ? '5+ years' : Math.round(m) + ' months');

// ---------------- THEME ----------------
const THEME = { name: 'CampusVend', headFontFace: 'Cambria', bodyFontFace: 'Calibri',
  colors: { dk1: '0F2E2D', lt1: 'FFFFFF', dk2: '475569', lt2: 'EEF5F4', accent1: '0F766E', accent2: 'F59E0B', accent3: '14B8A6', accent4: 'B45309', accent5: '94A3B8', accent6: 'DC2626', hlink: '0F766E', folHlink: '475569' } };
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';   // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'CampusVend — smart vending for VIT'; pres.author = 'CampusVend';
const C = pres.SchemeColor;
const HEX = THEME.colors;

pres.defineSlideMaster({ title: 'Dark', background: { color: HEX.dk1 }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.3, w: 11.7, h: 1.6, fontSize: 44, bold: true, color: C.background1, align: 'left', valign: 'top' }, text: '' } },
  { placeholder: { options: { name: 'body', type: 'body', x: 0.8, y: 4.0, w: 11.0, h: 1.6, fontSize: 20, color: C.background2, align: 'left', valign: 'top' }, text: '' } },
] });
pres.defineSlideMaster({ title: 'Content', background: { color: HEX.lt1 }, slideNumber: { x: 12.2, y: 6.95, w: 0.6, h: 0.3, fontSize: 10, color: C.text2 }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 34, bold: true, color: C.text1, align: 'left', valign: 'middle' }, text: '' } },
  { text: { text: 'CampusVend · proposal for VIT Vellore · figures are estimates to be validated in the pilot', options: { x: 0.6, y: 6.95, w: 10, h: 0.3, fontSize: 10, color: C.text2, margin: 0 } } },
] });

let sec = '';
const section = (t) => { sec = t; pres.addSection({ title: t }); };
const slide = (title, notes) => { const s = pres.addSlide({ masterName: 'Content', sectionTitle: sec }); s.addText(title, { placeholder: 'title' }); if (notes) s.addNotes(notes); return s; };
const text = (s, t, o) => s.addText(t, { isTextBox: true, margin: 0, fontSize: 14, color: C.text1, valign: 'top', ...o });
const card = (s, x, y, w, h, fill = C.background2) => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill, width: 0 } });
const badge = (s, x, y, label, fill = C.accent1) => { s.addShape(pres.ShapeType.ellipse, { x, y, w: 0.55, h: 0.55, fill: { color: fill }, line: { color: fill, width: 0 } }); s.addText(String(label), { isTextBox: true, x, y, w: 0.55, h: 0.55, margin: 0, align: 'center', valign: 'middle', fontSize: 16, bold: true, color: C.background1 }); };
const stat = (s, x, y, w, big, small, fill = C.background2, ink = C.accent1) => { card(s, x, y, w, 1.55, fill); text(s, big, { x: x + 0.25, y: y + 0.18, w: w - 0.5, h: 0.75, fontSize: 32, bold: true, color: ink, valign: 'middle' }); text(s, small, { x: x + 0.25, y: y + 0.95, w: w - 0.5, h: 0.5, fontSize: 14, color: C.text2 }); };
const chartStyle = { catAxisLabelColor: HEX.dk2, valAxisLabelColor: HEX.dk2, catAxisLabelFontSize: 12, valAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', dataLabelFontFace: '+mn-lt', titleFontFace: '+mn-lt',
  valGridLine: { color: 'E2E8F0', size: 0.75 }, catGridLine: { style: 'none' }, showLegend: false, showValue: true, dataLabelColor: HEX.dk1, dataLabelFontSize: 12, dataLabelPosition: 'outEnd', chartColors: [HEX.accent1] };
const table = (s, rows, o) => s.addTable(rows.map((r, i) => r.map((c, j) => ({ text: String(c), options: { bold: i === 0 || (o.boldCol === j), color: i === 0 ? C.background1 : C.text1, fill: { color: i === 0 ? C.accent1 : i % 2 ? C.background1 : C.background2 }, align: j === 0 ? 'left' : (o.align || 'left'), valign: 'middle' } }))),
  { x: o.x, y: o.y, w: o.w, colW: o.colW, fontSize: o.fontSize || 14, rowH: o.rowH || 0.46, border: { type: 'solid', color: 'E2E8F0', pt: 0.75 }, margin: [0.04, 0.12, 0.04, 0.12] });

// ================= 1. Title =================
section('Overview');
{ const s = pres.addSlide({ masterName: 'Dark', sectionTitle: sec });
  s.addText('CampusVend: snacks where and when campus shops are not', { placeholder: 'title' });
  s.addText('Wi-Fi managed smart vending machines for VIT Vellore — SMV, MB, SJT-CDC and hostels after closing time', { placeholder: 'body' });
  s.addShape(pres.ShapeType.ellipse, { x: 10.9, y: 0.7, w: 1.5, h: 1.5, fill: { color: C.accent3 }, line: { color: C.accent3, width: 0 } });
  text(s, 'UPI · Card tap · Touchscreen · Remote admin', { x: 0.8, y: 6.3, w: 11, h: 0.4, fontSize: 16, color: C.accent3 });
  s.addNotes('Opening. All numbers in this deck are planning estimates, not measured VIT data; the pilot is designed to measure them.'); }

// ================= 2. The gap =================
{ const s = slide('Students cannot buy a snack in three situations', 'The three target situations come from the brief: academic blocks without shops, hostels after closing, and the CDC office in SJT where shops are far.');
  const items = [['Academic blocks with no shop', 'SMV and MB', 'Between classes there is no time to walk to a canteen and back. A machine in the lobby serves a 10-minute break.'],
    ['Hostels after closing time', "Men's and Ladies' hostels", 'From the time shops and canteens close until they reopen, nothing is available inside the hostel zone. Machines sell only in that window.'],
    ['Offices far from shops', 'CDC office, SJT', 'Students waiting for placement activity and staff have no nearby outlet. One machine covers the floor.']];
  items.forEach(([h, where, body], i) => { const x = 0.6 + i * 4.1; card(s, x, 1.6, 3.85, 4.6); badge(s, x + 0.3, 1.9, i + 1);
    text(s, h, { x: x + 0.3, y: 2.65, w: 3.25, h: 0.8, fontSize: 20, bold: true }); text(s, where, { x: x + 0.3, y: 3.5, w: 3.25, h: 0.4, fontSize: 14, bold: true, color: C.accent1 }); text(s, body, { x: x + 0.3, y: 4.0, w: 3.25, h: 2.0, fontSize: 15, color: C.text2 }); }); }

// ================= 3. Solution =================
{ const s = slide('One system: machine, kiosk screen and admin portal', 'Software is already built and runs end to end in demo mode with a simulated machine.');
  const cols = [['Machine', '48 selections on 6 trays, cooled to 5–8 °C, glass front, LED lighting, drop sensor that confirms every delivery, electronic door lock.'],
    ['Kiosk touchscreen', '15.6" screen. Pick an item, pay by UPI QR or tap a debit / credit card, collect. Automatic refund if the item does not drop.'],
    ['Admin portal', 'From any browser: put a machine to sleep with a message, switch lights, set selling hours, see stock, payments, forecasts and alerts.']];
  cols.forEach(([h, b], i) => { const x = 0.6 + i * 4.1; s.addShape(pres.ShapeType.ellipse, { x: x + 1.2, y: 1.6, w: 1.4, h: 1.4, fill: { color: i === 1 ? C.accent2 : C.accent1 }, line: { color: C.background1, width: 0 } });
    text(s, ['M', 'K', 'A'][i], { x: x + 1.2, y: 1.6, w: 1.4, h: 1.4, align: 'center', valign: 'middle', fontSize: 40, bold: true, color: C.background1 });
    text(s, h, { x, y: 3.25, w: 3.85, h: 0.5, fontSize: 22, bold: true, align: 'center' }); text(s, b, { x: x + 0.2, y: 3.9, w: 3.45, h: 2.4, fontSize: 15, color: C.text2 }); }); }

// ================= 4. Machine model =================
section('Product');
{ const s = slide('The machine: 1050 × 820 × 1900 mm, 48 selections', 'Drawing is schematic. The fabrication pack has an interactive 3D model, STL/OpenSCAD files and elevations.');
  const ox = 0.9, oy = 1.55, k = 0.0026;   // mm -> inches
  const r = (x, z, w, h, fill, line) => s.addShape(pres.ShapeType.rect, { x: ox + x * k, y: oy + (1900 - z - h) * k, w: w * k, h: h * k, fill: { color: fill }, line: { color: line || C.text1, width: 1 } });
  r(0, 0, 1050, 1900, C.text2); r(0, 0, 1050, 100, C.text1); r(50, 640, 660, 1200, C.background2);
  for (let i = 0; i < 6; i++) r(60, 680 + i * 190, 640, 22, C.accent5, C.accent5);
  r(770, 380, 280, 1520, C.text1); r(795, 1050, 230, 380, C.accent3); r(850, 800, 120, 190, C.accent2); r(110, 440, 540, 160, C.accent5);
  text(s, 'Front view (schematic)', { x: ox, y: 6.55, w: 2.8, h: 0.3, fontSize: 11, color: C.text2 });
  const spec = [['Capacity', '6 trays × 8 spirals, about 450 items'], ['Products', 'Snacks, biscuits, chocolates, juices, protein bars'], ['Cooling', '5–8 °C with insulated body and double glazing'], ['Screen', '15.6" portrait capacitive touchscreen'],
    ['Payments', 'UPI QR on screen; bank-certified NFC card terminal'], ['Controller', 'Raspberry Pi 5 + Arduino Mega motor board'], ['Network', 'LAN first, Wi-Fi as backup; outgoing connections only'], ['Security', 'Solenoid lock, door + tilt alarm, PIN-logged restocking']];
  table(s, [['Feature', 'Specification'], ...spec], { x: 4.4, y: 1.55, w: 8.3, colW: [1.9, 6.4], rowH: 0.5 }); }

// ================= 5. Purchase flow =================
{ const s = slide('A purchase takes under 30 seconds', 'If the drop sensor sees nothing within 7 seconds the slot is disabled, the customer is refunded automatically and the admin is alerted.');
  const steps = [['Choose', 'Tap an item on the touchscreen'], ['Pay', 'Scan the UPI QR or tap a card'], ['Confirm', 'Payment provider confirms to the server'], ['Dispense', 'Spiral turns until the drop sensor sees the item'], ['Record', 'Stock, payment and analytics update instantly']];
  steps.forEach(([h, b], i) => { const x = 0.6 + i * 2.48; card(s, x, 2.2, 2.2, 2.9, i === 3 ? C.accent1 : C.background2); const dark = i === 3;
    badge(s, x + 0.25, 2.45, i + 1, dark ? C.accent2 : C.accent1);
    text(s, h, { x: x + 0.25, y: 3.2, w: 1.7, h: 0.45, fontSize: 20, bold: true, color: dark ? C.background1 : C.text1 }); text(s, b, { x: x + 0.25, y: 3.75, w: 1.75, h: 1.2, fontSize: 14, color: dark ? C.background1 : C.text2 });
    if (i < 4) s.addShape(pres.ShapeType.rightArrow, { x: x + 2.22, y: 3.5, w: 0.24, h: 0.3, fill: { color: C.accent5 }, line: { color: C.accent5, width: 0 } }); });
  text(s, 'Failed delivery → automatic refund, slot locked out, admin notified on Telegram.', { x: 0.6, y: 5.55, w: 12, h: 0.4, fontSize: 16, color: C.accent4, bold: true }); }

// ================= 6. Admin portal =================
{ const s = slide('The admin controls every machine from a browser', 'Roles: admin (everything) and restocker (stock only, 6-digit service PIN at the machine).');
  const f = [['Remote control', 'Sleep / wake with a custom on-screen message, lights on-off-auto, selling hours per machine, door unlock, restart.'],
    ['Stock tracking', 'Live quantity for each of the 48 slots, one-tap refill recording, restock history by person.'],
    ['Demand forecast', 'Sales per day per product, days of stock left, and a purchase list for the next 3–30 days.'],
    ['Payment tracking', 'Every UPI and card transaction with status, refunds due, filters and CSV export for accounts.'],
    ['Analytics', 'Sales by day, hour, category, machine and product; margin and busiest hours.'],
    ['Malfunction alerts', 'Offline, jam, failed vend, high temperature, door opened without login, tilt, low stock.']];
  f.forEach(([h, b], i) => { const x = 0.6 + (i % 3) * 4.1, y = 1.55 + Math.floor(i / 3) * 2.6; card(s, x, y, 3.85, 2.35);
    text(s, h, { x: x + 0.3, y: y + 0.25, w: 3.3, h: 0.45, fontSize: 19, bold: true, color: C.accent1 }); text(s, b, { x: x + 0.3, y: y + 0.8, w: 3.3, h: 1.4, fontSize: 14, color: C.text2 }); }); }

// ================= 7. Demand =================
section('Market');
{ const s = slide('Expected demand by site (to be validated)', 'These are planning assumptions, not survey results. Run a one-week footfall count and a short student survey per site before fixing the product mix and volumes.');
  table(s, [['Site', 'Selling hours', 'Who buys', 'Orders / day (base)'],
    ['SMV ground floor', '08:00–20:00', 'Students between classes', '110'], ['MB lobby', '08:00–20:00', 'Students, visitors, staff', '110'], ['SJT – CDC office', '08:00–20:00', 'Placement candidates, staff', '110'],
    ["Men's hostel block", 'Shop closing → opening', 'Residents at night', '160'], ["Ladies' hostel block", 'Shop closing → opening', 'Residents at night', '160']],
    { x: 0.6, y: 1.55, w: 8.1, colW: [2.3, 2.2, 2.3, 1.3], rowH: 0.55 });
  stat(s, 9.0, 1.55, 3.7, String(bs.orders), 'average orders per machine per day'); stat(s, 9.0, 3.3, 3.7, '₹' + bs.ticket, 'average order value');
  text(s, 'How to validate in week 1: count people passing each site per hour, and survey 200 students on what they would buy, at what hours and price.', { x: 0.6, y: 5.3, w: 8.1, h: 0.9, fontSize: 15, color: C.text2 });
  text(s, 'No VIT sales data exists yet — the pilot produces it.', { x: 9.0, y: 5.1, w: 3.7, h: 0.8, fontSize: 14, bold: true, color: C.accent4 }); }

// ================= 8. Vendors =================
{ const s = slide('Existing campus vendors are not affected', 'Vendor protection is enforced by software (selling hours) and by contract (sourcing, price, product range).');
  const rows = [['Different places', 'Academic machines go only where no shop exists nearby: SMV, MB and the SJT CDC floor.'],
    ['Different hours', 'Hostel machines are locked in sleep mode while shops and canteens are open; the screen points students to the canteen.'],
    ['Vendors supply the stock', 'Products are bought from current campus vendors at an agreed wholesale rate, so every machine sale is also their sale.'],
    ['Same MRP, packaged goods only', 'No discounts below shop prices and no tea, meals or fresh food — the machine does not compete on the canteen menu.']];
  rows.forEach(([h, b], i) => { const y = 1.55 + i * 1.25; badge(s, 0.7, y + 0.15, i + 1, i === 2 ? C.accent2 : C.accent1);
    text(s, h, { x: 1.55, y: y + 0.02, w: 3.6, h: 0.9, fontSize: 19, bold: true, valign: 'middle' }); text(s, b, { x: 5.3, y: y + 0.02, w: 7.3, h: 0.9, fontSize: 15, color: C.text2, valign: 'middle' }); }); }

// ================= 9. Cost =================
section('Financials');
{ const s = slide('Implementation cost: about ' + L(B.fleetCapex) + ' for 5 machines', 'Single-unit retail estimates; see hardware/BOM.md for the line items. Quotes for cabinet and cooling move the total most.');
  const blocks = [['Cabinet, trays, pickup bin', 62.5], ['Motors, controller, sensors', 33.6], ['Computer, screen, network', 25], ['Cooling deck', 22], ['Assembly + wiring', 8], ['Power + protection', 8]];
  s.addChart(pres.charts.BAR, [{ name: '₹ thousand per machine', labels: blocks.map((b) => b[0]), values: blocks.map((b) => b[1]) }],
    { x: 0.6, y: 1.5, w: 7.6, h: 5.1, barDir: 'bar', ...chartStyle, showTitle: true, title: 'Build cost per machine (₹ thousand)', titleFontSize: 14, titleColor: HEX.dk1, catAxisOrientation: 'maxMin', dataLabelFormatCode: '0.0' });
  stat(s, 8.6, 1.55, 4.1, L(A.capexPerMachine), 'build cost per machine'); stat(s, 8.6, 3.3, 4.1, L(A.setupOneTime), 'one-time install, spares, signage');
  stat(s, 8.6, 5.05, 4.1, L(B.fleetCapex), 'total for 5-machine rollout', C.accent1, C.background1); }

// ================= 10. Unit economics =================
{ const s = slide('Each machine nets about ' + L(B.net) + ' a year (base case)', `Base: ${bs.orders} orders/day × ₹${bs.ticket} × ${A.days} days; gross margin ${bs.margin * 100}%; VIT share ${bs.vit * 100}% of sales; payment fees ${A.payFee * 100}%; shrinkage ${A.shrink * 100}%.`);
  const other = A.fixed['Maintenance + spares'] + A.fixed['Card terminal rental'] + A.fixed['Server + software'] + B.shr;
  const rows = [['Sales', B.rev], ['Gross margin (' + bs.margin * 100 + '%)', B.gm], ['VIT share (' + bs.vit * 100 + '% of sales)', -B.vit], ['Restocking staff', -A.fixed['Restocking staff']], ['Payment fees', -B.fee], ['Electricity', -A.fixed['Electricity']], ['Maintenance, terminal, server, shrinkage', -other], ['Net profit', B.net]];
  table(s, [['Per machine, per year', '₹'], ...rows.map(([n, v]) => [n, (v < 0 ? '− ' : '') + Math.abs(Math.round(v)).toLocaleString('en-IN')])], { x: 0.6, y: 1.55, w: 6.3, colW: [4.5, 1.8], align: 'right', rowH: 0.5 });
  s.addChart(pres.charts.BAR, [{ name: '₹ thousand', labels: ['Gross margin', 'VIT share', 'Staff', 'Fees', 'Power', 'Other', 'Net profit'], values: [B.gm, B.vit, A.fixed['Restocking staff'], B.fee, A.fixed['Electricity'], other, B.net].map((v) => Math.round(v / 1000)) }],
    { x: 7.2, y: 1.5, w: 5.5, h: 5.1, barDir: 'col', ...chartStyle, showTitle: true, title: 'Where the gross margin goes (₹ thousand)', titleFontSize: 14, titleColor: HEX.dk1 }); }

// ================= 11. Scenarios =================
{ const s = slide('Payback depends on daily orders', 'Conservative case does not pay back — that is why the plan starts with one pilot machine before buying five.');
  const names = Object.keys(M);
  table(s, [['', ...names], ['Orders per machine per day', ...names.map((n) => A.scen[n].orders)], ['Average order value', ...names.map((n) => '₹' + A.scen[n].ticket)], ['Gross margin', ...names.map((n) => A.scen[n].margin * 100 + '%')],
    ['Sales per machine per year', ...names.map((n) => L(M[n].rev))], ['Net profit per machine per year', ...names.map((n) => L(M[n].net))], ['Fleet net profit per year', ...names.map((n) => L(M[n].fleetNet))], ['Payback on ' + L(B.fleetCapex), ...names.map((n) => mo(M[n].payback))]],
    { x: 0.6, y: 1.55, w: 8.3, colW: [3.5, 1.6, 1.6, 1.6], align: 'right', rowH: 0.52, boldCol: 2 });
  stat(s, 9.2, 1.55, 3.5, beOpex + ' / day', 'orders to cover running costs'); stat(s, 9.2, 3.3, 3.5, be24 + ' / day', 'orders for a 24-month payback');
  text(s, 'Below about ' + be24 + ' orders a day a site should be relocated, not kept.', { x: 9.2, y: 5.1, w: 3.5, h: 1.0, fontSize: 15, bold: true, color: C.accent4 }); }

// ================= 12. VIT share =================
{ const s = slide('What VIT receives', 'Share percentage is a proposal for negotiation. Electricity is paid by the operator in this model.');
  stat(s, 0.6, 1.6, 3.85, L(B.vit * A.machines), 'a year to VIT at ' + bs.vit * 100 + '% of sales (base case)', C.accent1, C.background1);
  stat(s, 4.7, 1.6, 3.85, '₹0', 'investment and running cost for VIT'); stat(s, 8.8, 1.6, 3.85, '24 × 7', 'coverage across academic and hostel zones');
  const pts = [['Student welfare', 'Food and drink available during late study hours and between classes without leaving the block.'], ['Full transparency', 'Read-only portal login for the estates office: sales, share due and uptime per machine.'], ['Cashless and auditable', 'Only UPI and card; every rupee is traceable to a transaction reference.'], ['Student-built', 'Designed, built and maintained on campus — a live project for engineering students.']];
  pts.forEach(([h, b], i) => { const x = 0.6 + (i % 2) * 6.15, y = 3.6 + Math.floor(i / 2) * 1.5; badge(s, x, y, i + 1, C.accent2); text(s, h, { x: x + 0.75, y: y - 0.05, w: 5.1, h: 0.4, fontSize: 18, bold: true }); text(s, b, { x: x + 0.75, y: y + 0.4, w: 5.1, h: 0.85, fontSize: 14, color: C.text2 }); }); }

// ================= 13. Rollout =================
section('Plan');
{ const s = slide('Rollout: one pilot machine, then five', 'Go / no-go gate after the pilot uses measured orders per day against the break-even figure.');
  const ph = [['Weeks 1–4', 'Approvals + build', 'Permission from estates and IT (LAN port, device registration). Payment merchant onboarding. Fabricate and wire machine 1.'],
    ['Weeks 5–12', 'Pilot at one hostel', 'Run one machine in night-only mode. Measure orders per day, top products, failures, refunds.'],
    ['Week 13', 'Go / no-go review', 'Proceed only if the pilot holds at or above ' + be24 + ' orders a day and vendors report no impact.'],
    ['Weeks 14–24', 'Scale to 5 sites', 'SMV, MB, SJT-CDC and the second hostel. Shared restocking round, vendor supply contracts.']];
  s.addShape(pres.ShapeType.rect, { x: 0.9, y: 2.33, w: 11.6, h: 0.05, fill: { color: C.accent5 }, line: { color: C.accent5, width: 0 } });
  ph.forEach(([w, h, b], i) => { const x = 0.6 + i * 3.08; badge(s, x + 0.3, 2.08, i + 1, i === 2 ? C.accent2 : C.accent1); card(s, x, 2.95, 2.85, 3.5);
    text(s, w, { x: x + 0.25, y: 3.15, w: 2.4, h: 0.35, fontSize: 14, bold: true, color: C.accent1 }); text(s, h, { x: x + 0.25, y: 3.55, w: 2.4, h: 0.8, fontSize: 19, bold: true }); text(s, b, { x: x + 0.25, y: 4.4, w: 2.4, h: 1.9, fontSize: 14, color: C.text2 }); }); }

// ================= 14. Risks =================
{ const s = slide('Risks and how each is handled', 'Card acceptance needs a bank-certified terminal from an acquirer; a hobby NFC reader cannot process bank cards.');
  table(s, [['Risk', 'Mitigation'],
    ['Low sales at a site', 'Pilot first; relocate any machine below break-even; forecasts tune the product mix'],
    ['Vandalism or theft', 'Steel body, toughened glass, anchored plinth, tilt and door alarms to admin, place under CCTV'],
    ['Item paid for but not delivered', 'Drop sensor confirms delivery; automatic refund and slot lock-out'],
    ['Network outage', 'LAN with Wi-Fi backup; machine stops selling safely when offline and alerts the admin'],
    ['Card payment compliance', 'Use only a bank-certified terminal from the acquirer; no card data touches our software'],
    ['Chocolate melting, expiry', 'Cooled cabinet with temperature alert; first-in-first-out loading; expiry check at each restock'],
    ['Food safety licensing', 'Operator registers under FSSAI before selling; packaged, sealed products only']],
    { x: 0.6, y: 1.5, w: 12.1, colW: [3.6, 8.5], rowH: 0.6 }); }

// ================= 15. Ask =================
{ const s = pres.addSlide({ masterName: 'Dark', sectionTitle: sec });
  s.addText('Approve a 12-week pilot at one hostel block', { placeholder: 'title' });
  s.addText([{ text: 'One machine, about ' + L(A.capexPerMachine + A.setupOneTime / A.machines) + ', funded by the team', options: { bullet: true, breakLine: true } },
    { text: 'VIT provides: a 1 m² spot near a power socket and a LAN port', options: { bullet: true, breakLine: true } },
    { text: 'Review in week 13 with measured sales before any further rollout', options: { bullet: true } }], { placeholder: 'body', paraSpaceAfter: 8 });
  s.addNotes('The ask: space, power, a registered network port, and a review date.'); }

const out = path.join(__dirname, 'CampusVend_VIT_Proposal.pptx');
pres.writeFile({ fileName: out }).then(async () => {
  if (applyTheme) await applyTheme(out, THEME); else console.warn('PPTX_SKILL_DIR not set — theme colours not applied');
  console.log('Wrote', out);
  console.log('Base case:', { perMachineNet: Math.round(B.net), fleetCapex: B.fleetCapex, paybackMonths: Math.round(B.payback), breakEvenOpex: beOpex, breakEven24: be24, vitShare: Math.round(B.vit * A.machines) });
});
