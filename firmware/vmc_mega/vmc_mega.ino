/*
 * CampusVend — Vending Machine Controller (VMC) firmware for Arduino Mega 2560
 * ---------------------------------------------------------------------------
 * Talks to the Raspberry Pi over USB serial (115200 baud, one text command per line).
 *
 *   PING            -> PONG CV-MEGA 1.0
 *   VEND <row> <col>-> OK VEND            spiral made exactly ONE turn and the drop sensor saw the item
 *                      ERR NO_DROP        one full turn done, nothing fell (slot empty) — never retried
 *                      ERR JAM            spiral did not get back to home in time
 *                      ERR MOTOR_NOT_TURNING / ERR HOME_LINE_FAULT   motor or home-switch wiring fault
 *                      ERR CHUTE_BLOCKED  drop sensor already blocked before starting
 *                      ERR RANGE          bad row / column
 *   LIGHT <0|1>     -> OK
 *   UNLOCK <sec>    -> OK                 opens the door lock for <sec> seconds (max 30)
 *   STATUS          -> STAT temp=<C|nan> door=<0|1> tilt=<0|1> light=<0|1> cool=<0|1>
 *
 * Libraries to install (Arduino IDE > Tools > Manage Libraries):
 *   - "OneWire" by Paul Stoffregen
 *   - "DallasTemperature" by Miles Burton
 * Board: Arduino Mega or Mega 2560, Processor: ATmega2560.
 *
 * WIRING SUMMARY (full tables in hardware/WIRING.md)
 *   D22-D27  row relays 1-6   (switch +24 V to a tray)
 *   D30-D37  column relays 1-8 (switch motor return to GND)
 *   D40 lights relay   D41 door-lock relay   D42 cooling-unit relay   D43 spare
 *   D2  drop sensor (LOW = beam broken)   D3 door switch (LOW = closed)
 *   D4  DS18B20 temperature data (4.7k pull-up to 5 V)   D5 tilt/vibration sensor (HIGH = alarm)
 *   D6  shared HOME line from all 48 motor cam switches (each through a 1N4148 diode)
 */
#include <OneWire.h>
#include <DallasTemperature.h>

// ---------------- configuration ----------------
const uint8_t ROWS = 6, COLS = 8;
const uint8_t ROW_PINS[ROWS] = {22, 23, 24, 25, 26, 27};
const uint8_t COL_PINS[COLS] = {30, 31, 32, 33, 34, 35, 36, 37};
const uint8_t PIN_LIGHT = 40, PIN_LOCK = 41, PIN_COOL = 42, PIN_SPARE = 43;
const uint8_t PIN_DROP = 2, PIN_DOOR = 3, PIN_TEMP = 4, PIN_TILT = 5;
const uint8_t PIN_HOME = 6;                // shared home-switch line: LOW while the selected spiral is mid-turn

const bool USE_HOME_SWITCH = true;         // true = exactly one turn per sale (recommended). false = stop on drop sensor only
const unsigned long HOME_LEAVE_MS = 1500;  // motor must leave home within this time, else it is not turning
const unsigned long TURN_MAX_MS = 6000;    // one full turn must finish within this time, else it is jammed
const unsigned long DROP_WAIT_MS = 1500;   // after the turn ends, wait this long for the item to pass the drop sensor

const bool RELAY_ACTIVE_LOW = true;        // most blue 5 V relay boards switch ON when the input is LOW
const unsigned long VEND_MAX_MS = 7000;    // longest a spiral motor may run for one vend (about 1.3 turns)
const unsigned long VEND_MIN_MS = 300;     // ignore drop-sensor noise while relays click
const unsigned long DROP_SETTLE_MS = 150;  // keep turning this long after the drop so the spiral clears
const float COOL_ON_C = 8.0, COOL_OFF_C = 5.0;         // thermostat band
const unsigned long COOL_MIN_OFF_MS = 180000UL;        // compressor must rest 3 min before restarting
// ------------------------------------------------

OneWire oneWire(PIN_TEMP);
DallasTemperature sensors(&oneWire);
volatile bool dropSeen = false;
float tempC = NAN;
bool lightOn = false, coolOn = false, tiltLatched = false;
unsigned long lockUntil = 0, coolOffAt = 0, lastTemp = 0;
char line[48]; uint8_t len = 0;

void relay(uint8_t pin, bool on) { digitalWrite(pin, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW); }
void allMotorsOff() { for (uint8_t i = 0; i < ROWS; i++) relay(ROW_PINS[i], false); for (uint8_t i = 0; i < COLS; i++) relay(COL_PINS[i], false); }
void onDrop() { dropSeen = true; }

void setup() {
  // Set relay outputs to their OFF level before making them outputs, so nothing clicks at power-up.
  const uint8_t aux[] = {PIN_LIGHT, PIN_LOCK, PIN_COOL, PIN_SPARE};
  for (uint8_t i = 0; i < ROWS; i++) { relay(ROW_PINS[i], false); pinMode(ROW_PINS[i], OUTPUT); }
  for (uint8_t i = 0; i < COLS; i++) { relay(COL_PINS[i], false); pinMode(COL_PINS[i], OUTPUT); }
  for (uint8_t i = 0; i < 4; i++) { relay(aux[i], false); pinMode(aux[i], OUTPUT); }
  pinMode(PIN_DROP, INPUT_PULLUP); pinMode(PIN_DOOR, INPUT_PULLUP); pinMode(PIN_TILT, INPUT); pinMode(PIN_HOME, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_DROP), onDrop, FALLING);
  sensors.begin(); sensors.setWaitForConversion(false); sensors.requestTemperatures();
  coolOffAt = millis();
  Serial.begin(115200);
}

// Waits until the HOME line has held `level` for 20 ms. Returns false if `limit` ms pass first.
bool waitHome(uint8_t level, unsigned long limit) {
  unsigned long start = millis(), since = 0;
  while (millis() - start < limit) {
    if (digitalRead(PIN_HOME) == level) { if (!since) since = millis(); if (millis() - since >= 20) return true; }
    else since = 0;
  }
  return false;
}

// ONE ITEM PER SALE: the spiral makes exactly one full turn, measured by the motor's cam (home) switch.
// One turn of the spiral pushes exactly one product off the tray. The drop sensor then confirms it fell.
// The motor is never run a second time for the same sale, so a customer can never receive two items.
void vendOneTurn(int row, int col) {
  if (digitalRead(PIN_HOME) == LOW) { Serial.println(F("ERR HOME_LINE_FAULT")); return; }   // a switch is stuck / shorted
  allMotorsOff(); delay(30);
  noInterrupts(); dropSeen = false; interrupts();
  relay(COL_PINS[col], true); delay(30); relay(ROW_PINS[row], true);
  bool left = waitHome(LOW, HOME_LEAVE_MS);                 // cam leaves the home notch
  bool back = left && waitHome(HIGH, TURN_MAX_MS);          // ...and comes back after one full turn
  allMotorsOff();                                           // stop exactly at home
  if (!left) { Serial.println(F("ERR MOTOR_NOT_TURNING")); return; }
  if (!back) { Serial.println(F("ERR JAM")); return; }
  unsigned long t = millis();
  while (!dropSeen && millis() - t < DROP_WAIT_MS) { if (digitalRead(PIN_DROP) == LOW) dropSeen = true; }
  Serial.println(dropSeen ? F("OK VEND") : F("ERR NO_DROP"));
}

void vend(int row, int col) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) { Serial.println(F("ERR RANGE")); return; }
  if (digitalRead(PIN_DROP) == LOW) { Serial.println(F("ERR CHUTE_BLOCKED")); return; }
  if (USE_HOME_SWITCH) { vendOneTurn(row, col); return; }
  // Fallback for motors without a home switch: run until the drop sensor sees the item.
  allMotorsOff(); delay(30);
  relay(COL_PINS[col], true); delay(30); relay(ROW_PINS[row], true);   // column first, then power
  unsigned long start = millis(); bool dropped = false;
  delay(VEND_MIN_MS); noInterrupts(); dropSeen = false; interrupts();
  while (millis() - start < VEND_MAX_MS) {
    if (dropSeen || digitalRead(PIN_DROP) == LOW) { dropped = true; delay(DROP_SETTLE_MS); break; }
  }
  allMotorsOff();                                                       // motors never stay powered
  Serial.println(dropped ? F("OK VEND") : F("ERR NO_DROP"));
}

void handle(char *cmd) {
  if (!strcmp(cmd, "PING")) Serial.println(F("PONG CV-MEGA 1.0"));
  else if (!strncmp(cmd, "VEND ", 5)) { int r = -1, c = -1; sscanf(cmd + 5, "%d %d", &r, &c); vend(r, c); }
  else if (!strncmp(cmd, "LIGHT ", 6)) { lightOn = cmd[6] == '1'; relay(PIN_LIGHT, lightOn); Serial.println(F("OK")); }
  else if (!strncmp(cmd, "UNLOCK ", 7)) { long s = constrain(atol(cmd + 7), 1, 30); lockUntil = millis() + s * 1000UL; relay(PIN_LOCK, true); Serial.println(F("OK")); }
  else if (!strcmp(cmd, "STATUS")) {
    Serial.print(F("STAT temp=")); if (isnan(tempC)) Serial.print(F("nan")); else Serial.print(tempC, 1);
    Serial.print(F(" door=")); Serial.print(digitalRead(PIN_DOOR) == HIGH ? 1 : 0);
    Serial.print(F(" tilt=")); Serial.print(tiltLatched ? 1 : 0); tiltLatched = false;
    Serial.print(F(" light=")); Serial.print(lightOn ? 1 : 0);
    Serial.print(F(" cool=")); Serial.println(coolOn ? 1 : 0);
  }
  else Serial.println(F("ERR UNKNOWN"));
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') { if (len) { line[len] = 0; handle(line); len = 0; } }
    else if (len < sizeof(line) - 1) line[len++] = ch;
  }
  unsigned long now = millis();
  if (lockUntil && (long)(now - lockUntil) >= 0) { relay(PIN_LOCK, false); lockUntil = 0; }
  if (digitalRead(PIN_TILT) == HIGH) tiltLatched = true;

  if (now - lastTemp >= 2000) {             // read temperature every 2 s and run the thermostat
    lastTemp = now;
    float t = sensors.getTempCByIndex(0);
    tempC = (t == DEVICE_DISCONNECTED_C) ? NAN : t;
    sensors.requestTemperatures();
    if (isnan(tempC)) { if (coolOn) { coolOn = false; coolOffAt = now; } }           // sensor fault: fail safe (off)
    else if (!coolOn && tempC >= COOL_ON_C && now - coolOffAt >= COOL_MIN_OFF_MS) coolOn = true;
    else if (coolOn && tempC <= COOL_OFF_C) { coolOn = false; coolOffAt = now; }
    relay(PIN_COOL, coolOn);
  }
}
