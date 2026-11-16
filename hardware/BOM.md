# CampusVend — Bill of Materials (one machine, 6 trays × 8 spirals = 48 selections)

Prices are **estimates in INR (late 2026, single-unit retail, before GST)** to plan the budget. Get real quotes before ordering — motors, cabinet and cooling vary the most between suppliers.

## A. Computer, screen, network

| # | Part | Spec to ask for | Qty | Est. ₹ |
|---|------|-----------------|-----|-------|
| A1 | Raspberry Pi 5 (4 GB) | with official 27 W USB-C power supply and active cooler | 1 | 7,500 |
| A2 | microSD card | 64 GB, A2, "high endurance" type | 1 | 900 |
| A3 | DIN-rail or metal case for Pi | with fan opening | 1 | 600 |
| A4 | Touchscreen monitor | 15.6", 1920×1080, **capacitive USB touch**, HDMI, open-frame or VESA mount, 12 V input, ≥300 nits | 1 | 14,000 |
| A5 | HDMI cable (micro-HDMI to HDMI), USB-A to USB-B cable for touch, USB-A to USB-B for Arduino | 0.5–1 m each | 3 | 700 |
| A6 | Ethernet | Cat6 patch cable + panel-mount RJ45 coupler (LAN is the primary link; Pi's built-in Wi-Fi is the fallback) | 1 | 400 |
| A7 | Wi-Fi antenna (only if LAN is not available) | USB Wi-Fi adapter with external 5 dBi antenna on 1 m lead — the steel cabinet blocks the Pi's internal antenna | 1 | 900 |

## B. Motor controller and I/O

| # | Part | Spec | Qty | Est. ₹ |
|---|------|------|-----|-------|
| B1 | Arduino Mega 2560 R3 | genuine or good clone with ATmega16U2 USB chip | 1 | 1,600 |
| B2 | Screw-terminal shield for Mega | so every wire is screwed, not pushed in | 1 | 600 |
| B3 | 8-channel 5 V relay module | opto-isolated, 10 A contacts, with JD-VCC jumper | 2 | 700 |
| B4 | 4-channel 5 V relay module | same family | 1 | 250 |
| B5 | Vending spiral motor | 24 V DC geared, ~20–30 rpm, standard vending mount, **with cam (home) microswitch** — needed for one-item-per-sale | 48 | 18,240 |
| B5a | Diode 1N4148 | one per motor home switch (protects the Arduino HOME input) | 48 | 100 |
| B6 | Spirals (coils) | match product: 8 turns for chips, 12–15 for chocolates, bottle spiral for juices | 48 | 7,200 |
| B7 | Diode 1N5408 (3 A) | one in series with each motor (stops sneak current in the matrix) | 48 | 250 |
| B8 | Diode 1N4007 | one across each motor (flyback), plus lock and spares | 55 | 110 |
| B9 | Drop sensor | vending IR light-curtain pair, 650–700 mm span, 12–24 V, NPN output | 1 | 2,500 |
| B10 | PC817 opto-isolator module (4-channel) | converts 24 V sensor signals to 5 V for the Arduino | 1 | 150 |
| B11 | DS18B20 waterproof probe + 4.7 kΩ resistor | 1 m lead | 1 | 150 |
| B12 | Magnetic reed door switch | normally-open, closes when door shut | 1 | 100 |
| B13 | SW-420 vibration sensor module | tilt / shake alarm | 1 | 60 |
| B14 | Solenoid lock | 24 V, fail-secure (locked without power), with mechanical key override latch | 1 | 900 |
| B15 | LED strip | 24 V cool white, 2 × 1.2 m, in aluminium channel with diffuser | 2 | 800 |

## C. Power and protection

| # | Part | Spec | Qty | Est. ₹ |
|---|------|------|-----|-------|
| C1 | SMPS 24 V 10 A | 240 W, enclosed (Mean Well LRS-250-24 class) | 1 | 2,400 |
| C2 | Buck converter 24 V → 5 V 3 A | powers the relay coils (JD-VCC), isolated from the Arduino's 5 V | 1 | 250 |
| C3 | Screen power | 12 V adapter that comes with the screen, or 24 V → 12 V 3 A buck | 1 | 300 |
| C4 | Mains protection | IEC C14 inlet with switch, 6 A double-pole MCB, 30 mA RCBO, Type-2 surge protector | 1 set | 2,400 |
| C5 | Cooling switch | 25 A solid-state relay (SSR-25DA with heatsink) **or** 230 V contactor with 24 V coil | 1 | 600 |
| C6 | DIN rail, terminal blocks, blade-fuse holders (5 A motors, 2 A lock, 2 A LEDs), ferrules, 1.0 / 0.5 mm² wire, cable ties, glands | | 1 lot | 2,000 |

## D. Payment

| # | Part | Note | Qty | Est. ₹ |
|---|------|------|-----|-------|
| D1 | Bank-certified card terminal with NFC tap | **Supplied by your acquirer** (Pine Labs / Razorpay POS / Paytm / PhonePe / your bank). Ask for an *unattended* or countertop Android terminal with **cloud / push-to-terminal API** and Wi-Fi or LAN. | 1 | rental ≈ 300–700 / month |
| D2 | UPI QR | No hardware — the QR is shown on the touchscreen. Needs a payment-gateway merchant account (Razorpay is wired in). | – | 0 |

> A hobby NFC module (PN532 / RC522) **cannot** take debit or credit cards. Card payments require an EMV- and PCI-certified terminal issued through an RBI-regulated acquirer. The terminal does the tap; the server only tells it the amount and waits for "approved".

## E. Cabinet and cooling (give `structure/` files to the fabricator)

| # | Part | Spec | Est. ₹ |
|---|------|------|-------|
| E1 | Cabinet 1050 × 820 × 1900 mm | 1.2–1.5 mm CRCA, powder coated, 40 mm PUF insulation around product space, door with double-glazed toughened glass, plinth with levelling feet | 45,000 |
| E2 | 6 pull-out trays with dividers, motor rails, telescopic slides | galvanised or SS, product pushers optional | 14,000 |
| E3 | Pickup bin with anti-theft flap | SS 304 | 3,500 |
| E4 | Cooling deck | 1/5 HP hermetic compressor (R600a or R134a), condenser + fan, evaporator + fan, capillary — holds 4–8 °C at 40 °C ambient | 22,000 |
| E5 | Assembly, wiring labour, consumables | | 8,000 |

## Budget summary (per machine)

| Block | Est. ₹ |
|-------|-------|
| A. Computer, screen, network | 25,000 |
| B. Controller, motors, sensors | 33,600 |
| C. Power and protection | 7,950 |
| E. Cabinet, trays, cooling, assembly | 92,500 |
| **Total build cost** | **≈ 1,59,000** |

The business deck rounds this to **₹1.6 lakh per machine**. An ambient (no-cooling) version for biscuits/snacks only saves about ₹30,000, but chocolates and juices need cooling in Vellore's climate.

## Software / drivers to install (all free)

| Where | What | How |
|-------|------|-----|
| Server (any Linux VM or PC) | Node.js 22.5 or newer | nodejs.org — no other packages needed |
| Raspberry Pi | Raspberry Pi OS Lite 64-bit | Raspberry Pi Imager |
| Raspberry Pi | Chromium, cage, wlr-randr, python3-serial | installed automatically by `os/install-kiosk.sh` |
| Arduino Mega | Arduino IDE 2.x + libraries **OneWire** and **DallasTemperature** | Library Manager, then upload `firmware/vmc_mega/vmc_mega.ino` |
| Touchscreen | none — capacitive USB touch is plug-and-play (USB HID) on Linux | – |
| Mega USB | none for genuine boards (CDC-ACM, shows up as `/dev/ttyACM0`). Clones with a CH340 chip show up as `/dev/ttyUSB0` — change `serial_port` in `config.json`. | – |
