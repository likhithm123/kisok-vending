# CampusVend — Wiring and circuits

Block diagram: [wiring.svg](wiring.svg). Part numbers (A1, B3 …) refer to [BOM.md](BOM.md).

> **Safety.** The 230 V side (inlet, MCB, RCBO, power supplies, compressor) must be wired and tested by a licensed electrician. Earth the cabinet body, door and every metal tray rail. Never work on the motor matrix with the 24 V supply on. This design has been checked on paper and in software simulation; it has **not** yet been built and tested as a physical machine — build one prototype and run the bring-up checklist at the end before ordering parts for five.

## 1. Power distribution

```
230 V mains ─ IEC inlet+switch ─ MCB 6 A (DP) ─ RCBO 30 mA ─ surge protector ─┬─ 24 V 10 A SMPS (C1)
                                                                              ├─ Pi 5 power supply (A1)
                                                                              ├─ screen 12 V adapter (C3)
                                                                              ├─ card terminal charger (D1)
                                                                              └─ SSR / contactor (C5) ─ cooling deck (E4)

24 V + ─┬─ fuse 5 A ─ ROW relays (motor matrix)
        ├─ fuse 2 A ─ lights relay ─ LED strips
        ├─ fuse 2 A ─ lock relay ─ solenoid lock
        ├─ drop sensor supply
        └─ buck 24→5 V (C2) ─ JD-VCC of all three relay boards
24 V − ── common ground bar (also joined to Arduino GND at ONE point)
```

- Remove the **JD-VCC ↔ VCC jumper** on each relay board. Connect JD-VCC to the 5 V buck (C2) and the board's VCC pin to the Arduino's 5 V. This keeps relay-coil noise out of the Arduino.
- The Arduino Mega is powered from the Raspberry Pi through its USB cable. Do not connect another supply to its barrel jack.

## 2. Arduino Mega pin map

| Mega pin | Goes to | Notes |
|----------|---------|-------|
| D22, D23, D24, D25, D26, D27 | Relay board 1, IN1–IN6 | Rows = trays A (top) … F (bottom) |
| D30, D31, D32, D33, D34, D35, D36, D37 | Relay board 2, IN1–IN8 | Columns 1 (left) … 8 (right) |
| D40 | Relay board 3, IN1 | Lights |
| D41 | Relay board 3, IN2 | Door lock |
| D42 | Relay board 3, IN3 | Cooling (drives SSR / contactor) |
| D43 | Relay board 3, IN4 | Spare |
| D2 | Drop sensor, through opto module (B10) | Must read **LOW when the beam is broken** |
| D3 | Door reed switch → GND | Internal pull-up used. LOW = door closed |
| D4 | DS18B20 data (yellow) | 4.7 kΩ from D4 to 5 V. Red → 5 V, black → GND |
| D5 | SW-420 DO | HIGH = vibration. Adjust the trimmer so a firm knock does not trigger, a shake does |
| D6 | Shared HOME line from all motor cam switches | Internal pull-up used. LOW = selected spiral is mid-turn (see section 3) |
| 5 V, GND | VCC / GND of relay boards (logic side), sensors | |
| USB-B | Raspberry Pi USB port | Power + data |

Relay boards are "active-low" (relay ON when the pin is LOW). If yours are active-high, change `RELAY_ACTIVE_LOW` to `false` in the firmware.

## 3. Motor matrix (48 motors with 14 relays)

One **row relay** feeds +24 V to all motors of a tray; one **column relay** connects one position in every tray to ground. Only the motor at the crossing turns.

```
                +24 V ── fuse 5 A ──┬──────────┬───── … (COM of row relays 1–6)
                                    │          │
                         Row relay A NO     Row relay B NO
                                    │          │
          row bus A ────────────────┴──┬───────┼──────┬──────── …
                                       ▼ 1N5408       ▼ 1N5408      (one series diode per motor,
                                     [M A1]         [M A2]            stripe/cathode towards motor +)
                                       │              │
          row bus B ───────────────────┼──┬───────────┼──┬───── …
                                       │  ▼           │  ▼
                                       │ [M B1]       │ [M B2]
                                       │  │           │  │
          column wire 1 ───────────────┴──┘           │  │
          column wire 2 ──────────────────────────────┴──┘
                 │                          │
          Col relay 1 NO              Col relay 2 NO        (COM of column relays → 24 V −)
```

For **each** motor:

1. Row bus → **1N5408 anode**; 1N5408 cathode (stripe) → motor **+**.
2. Motor **−** → column wire for its position.
3. **1N4007 across the motor terminals**, stripe on the motor + side (absorbs the switch-off spike).

Wire colours suggestion: rows = red with tray letter sleeve, columns = black with number sleeve. Bring the 6 row wires and 8 column wires from the trays to the electronics bay through a 14-way plug per tray harness so trays can be removed.

### One item per sale — home (cam) switch

Each vending motor has a small cam microswitch that changes state once per turn. Use the contact that is **open when the spiral is parked at home and closed while it is turning**.

For **each** motor, in addition to the three steps above:

4. Switch terminal 1 → that motor's **column wire** (same point as motor −).
5. Switch terminal 2 → **1N4148 cathode (stripe)**; 1N4148 anode → the shared **HOME line**.
6. The HOME line (one wire for all 48 motors, daisy-chained along each tray) → Arduino **D6**.

Only the selected column is grounded, and only the turning motor has its switch closed, so D6 reads LOW exactly while that one spiral is mid-turn. The diode stops 24 V from unselected columns reaching the Arduino — **do not leave it out**.

**How a vend works (firmware):**

1. Column relay on → row relay on → the spiral starts.
2. D6 goes LOW (cam left home), then HIGH again after exactly one full turn → both relays off at once. One turn pushes exactly one product off the tray.
3. The IR drop sensor must have seen the item during the turn or within 1.5 s after it.
4. The motor is **never** run a second time for the same sale, so a customer cannot receive two items.

| Result | Meaning | What the system does |
|--------|---------|----------------------|
| `OK VEND` | One turn, item seen | Stock −1, sale completed |
| `ERR NO_DROP` | One turn, nothing fell (slot empty or product stuck) | Refund, slot disabled, admin alerted |
| `ERR JAM` | Spiral did not return home within 6 s | Refund, slot disabled, admin alerted |
| `ERR MOTOR_NOT_TURNING` | Cam never left home (motor, diode or wiring) | Refund, slot disabled, admin alerted |
| `ERR HOME_LINE_FAULT` | D6 already LOW before starting (stuck or shorted switch) | Refund, slot disabled, admin alerted |

The server also sells one item at a time: it refuses a new order while the machine is dispensing, and the firmware handles one `VEND` command at a time.

Loading rule that keeps this true: **one product per spiral gap**, and after loading every spiral must be parked at home (use *Test a slot* on an empty spiral to park it). If your motors have no cam switch, set `USE_HOME_SWITCH` to `false` in the firmware; the motor then stops as soon as the drop sensor sees an item, which is less exact.

## 4. Sensors and actuators

| Device | Wiring |
|--------|--------|
| Drop sensor (B9) | Brown → +24 V, blue → 24 V −, black (NPN output) → opto module input −; opto input + → +24 V. Opto output side: collector → D2, emitter → Arduino GND. Check with a multimeter: D2 must drop to 0 V when you block the beam. |
| Door lock (B14) | +24 V → fuse 2 A → relay 3 CH2 COM; NO → solenoid +; solenoid − → 24 V −. 1N4007 across the solenoid (stripe to +). Lock stays locked without power; keep the key override accessible. |
| Lights (B15) | +24 V → fuse 2 A → relay 3 CH1 COM; NO → LED strip +; LED − → 24 V −. |
| Cooling (C5) | Relay 3 CH3 switches the SSR's 5 V input (or the contactor's 24 V coil). SSR output is in series with the compressor **live** wire. The firmware keeps 5–8 °C and waits 3 minutes between compressor starts. |
| Touchscreen (A4) | HDMI → Pi HDMI0; USB touch → Pi USB; 12 V power. |
| Card terminal (D1) | Only power (its own charger) and network (Wi-Fi or LAN). It talks to the bank and the CampusVend server over the internet — no data wires to the Pi or Arduino. |

## 5. Network (LAN first, Wi-Fi as backup)

- Plug the Pi's Ethernet port into a campus LAN socket through the RJ45 coupler (A6). LAN is far more reliable than Wi-Fi inside a steel box.
- Wi-Fi: set SSID/password in Raspberry Pi Imager when flashing, or `sudo nmcli device wifi connect "SSID" password "…"`.
- **Campus networks with a login page or 802.1X** (typical at universities) will block a headless device. Ask the IT department (CTS) to register each machine's MAC address on a device VLAN, and to allow outbound HTTPS to your server and to the payment provider.
- The machine only makes **outgoing** connections to the server. No ports need to be opened towards the machine.

## 6. Bring-up checklist (do in this order, on the bench before fitting into the cabinet)

1. Mains side alone: MCB/RCBO test button trips; 24.0 V at the SMPS output.
2. Upload the firmware. In Arduino IDE Serial Monitor (115200, "Newline"): `PING` → `PONG CV-MEGA 1.0`.
3. `STATUS` → temperature is a sensible number, `door=1` open / `door=0` closed when you move the magnet.
4. `LIGHT 1` / `LIGHT 0` clicks relay 3 CH1; `UNLOCK 5` opens the lock for 5 s.
5. With **one** motor connected: `VEND 0 0` turns motor A1 exactly one turn and stops at home. Pass your hand through the drop sensor during the turn → `OK VEND`; without a drop → `ERR NO_DROP`. Hold the spiral by hand → `ERR JAM` after 6 s. Load three items and vend three times: exactly one must fall each time.
6. Connect all motors and test every slot from the admin portal (*Machines → Test a slot*).
7. Run `install-kiosk.sh` on the Pi, confirm the machine shows **Online**, do a demo-mode purchase, then switch the server to live payments.
