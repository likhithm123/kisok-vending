# CampusVend — smart vending machines for VIT

| Folder | What it is |
|--------|-----------|
| `server/` | Admin portal + kiosk screen UI + machine API. Node.js 22.5+, no npm packages. |
| `agent/` | `vmc_agent.py` — runs on the Raspberry Pi in each machine (needs `pyserial`). |
| `firmware/vmc_mega/` | Arduino Mega 2560 motor/sensor controller firmware. |
| `os/` | `install-kiosk.sh` + systemd services that turn Raspberry Pi OS Lite into the kiosk. |
| `hardware/` | `BOM.md` (parts + cost), `WIRING.md` (pin tables, motor matrix, bring-up checklist), `wiring.svg`. |
| `structure/` | Cabinet 3D layout: `viewer.html`, `cabinet.stl`, `cabinet.scad`, `elevations.svg`, `FABRICATION.md`. |
| `business/` | `CampusVend_VIT_Proposal.pptx` and `build_deck.js` (edit the ASSUMPTIONS block, rebuild). |

## Try it on your laptop (no hardware)

```bash
cd server && node seed.js && node server.js
```

- Admin portal: http://localhost:8080/admin/ — login is in `server/data/initial-admin-password.txt`.
- `server/data/demo-credentials.json` holds the demo machine keys and the restocker's service PIN.
- Simulated machine: copy `agent/config.example.json` to `agent/config.json`, set `server_url` to `http://localhost:8080` and paste a machine key, then

```bash
python3 agent/vmc_agent.py agent/config.json --simulate
```

- Kiosk screen: `http://localhost:8080/kiosk/#key=<same machine key>`. Tap the logo 5 times for the restock menu.

The seed creates 45 days of **simulated** sales so the charts have data. Delete `server/data/` to start clean.

## Real machine, in order

1. Fabricate the cabinet from `structure/`. Buy parts from `hardware/BOM.md`.
2. Wire per `hardware/WIRING.md`; upload the firmware; run the bring-up checklist.
3. Put the server on a campus VM or cloud server (`os/campusvend-server.service`), behind HTTPS.
4. Admin portal → Machines → Add machine → copy the key.
5. On the Pi: `sudo bash os/install-kiosk.sh https://YOUR-SERVER MACHINE_KEY`, then reboot.

## Going live with payments

- **UPI QR:** start the server with `PAYMENT_PROVIDER=razorpay` plus `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Webhook URL: `/api/webhooks/razorpay` (event `qr_code.credited`); the server also polls, so it works without a public webhook.
- **Card / NFC tap:** needs a bank-certified terminal from an acquirer. Fill in `server/lib/card-edc.js` from their API document and set `CARD_PROVIDER=edc`. A PN532/RC522 reader cannot take bank cards.
- Without these variables the system runs in **demo mode** and collects no money.

## Not yet done / not yet tested

- Nothing has been run on physical hardware: firmware, wiring, the Pi installer and screen rotation are untested.
- The Razorpay path is written from their API but has not been exercised with a real account.
- The card-terminal adapter is a template.
- Deck figures are planning estimates, not VIT data.
