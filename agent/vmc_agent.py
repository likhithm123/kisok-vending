#!/usr/bin/env python3
"""
CampusVend machine agent — runs on the Raspberry Pi inside each vending machine.

  * keeps a connection to the CampusVend server (works over LAN or Wi-Fi, HTTP or HTTPS)
  * passes commands (vend, lights, unlock door, restart) to the Arduino Mega controller over USB
  * reports temperature, door, tilt and controller health so the admin portal can raise alerts

Usage:
  python3 vmc_agent.py config.json            real hardware (needs: pip install pyserial / apt install python3-serial)
  python3 vmc_agent.py config.json --simulate no hardware — pretends to be a machine (for demos and testing)
"""
import json
import os
import random
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

AGENT_VERSION = "agent-1.0"


class SimController:
    """Stands in for the Arduino when running with --simulate."""
    name = "SIMULATED"

    def __init__(self):
        self.light = False
        self.fail_slot = os.environ.get("SIM_FAIL_SLOT", "")   # e.g. SIM_FAIL_SLOT=A1 to demo a jam

    def ok(self):
        return True

    def vend(self, row, col):
        time.sleep(2.0)
        if self.fail_slot == f"{chr(65 + row)}{col + 1}":
            return False, "NO_DROP"
        return True, ""

    def light_set(self, on):
        self.light = on

    def unlock(self, seconds):
        pass

    def status(self):
        return {"temp_c": round(5.5 + random.uniform(-0.6, 0.6), 1), "door_open": False, "tilt": False}


class MegaController:
    """Serial link to the Arduino Mega running firmware/vmc_mega."""

    def __init__(self, port):
        import serial  # pyserial
        self._serial_mod = serial
        self.port = port
        self.ser = None
        self.lock = threading.Lock()
        self.name = "?"
        self._connect()

    def _connect(self):
        try:
            self.ser = self._serial_mod.Serial(self.port, 115200, timeout=2)
            time.sleep(2.5)                      # the Mega resets when the port opens
            self.ser.reset_input_buffer()
            reply = self._cmd("PING", 3)
            if not reply.startswith("PONG"):
                raise IOError("no PONG from controller")
            self.name = reply[5:]
            print(f"[agent] controller connected on {self.port}: {self.name}")
        except Exception as e:                   # noqa: BLE001 — keep running, report controller fault
            print(f"[agent] controller not available on {self.port}: {e}")
            self.ser = None

    def _cmd(self, text, timeout):
        self.ser.timeout = timeout
        self.ser.reset_input_buffer()
        self.ser.write((text + "\n").encode())
        return self.ser.readline().decode(errors="replace").strip()

    def _send(self, text, timeout=3):
        with self.lock:
            if self.ser is None:
                self._connect()
            if self.ser is None:
                return ""
            try:
                return self._cmd(text, timeout)
            except Exception as e:               # noqa: BLE001
                print(f"[agent] serial error: {e}")
                try:
                    self.ser.close()
                except Exception:                # noqa: BLE001
                    pass
                self.ser = None
                return ""

    def ok(self):
        return self.ser is not None

    def vend(self, row, col):
        reply = self._send(f"VEND {row} {col}", 12)
        if reply == "OK VEND":
            return True, ""
        return False, reply[4:] if reply.startswith("ERR ") else "controller not responding"

    def light_set(self, on):
        self._send(f"LIGHT {1 if on else 0}")

    def unlock(self, seconds):
        self._send(f"UNLOCK {int(seconds)}")

    def status(self):
        reply = self._send("STATUS")
        if not reply.startswith("STAT "):
            return {}
        kv = dict(p.split("=", 1) for p in reply[5:].split() if "=" in p)
        temp = kv.get("temp", "nan")
        return {"temp_c": None if temp == "nan" else float(temp), "door_open": kv.get("door") == "1", "tilt": kv.get("tilt") == "1"}


class Agent:
    def __init__(self, cfg, simulate):
        self.url = cfg["server_url"].rstrip("/") + "/api/agent/sync"
        self.key = cfg["machine_key"]
        self.ctl = SimController() if simulate else MegaController(cfg.get("serial_port", "/dev/ttyACM0"))
        self.results = []
        self.results_lock = threading.Lock()
        self.telemetry = {}
        self.light = None
        self.reboot_requested = False

    def sync(self, wait):
        with self.results_lock:
            results, self.results = self.results, []
        body = json.dumps({"telemetry": {**self.telemetry, "fw": f"{AGENT_VERSION} / {self.ctl.name}", "controller_ok": self.ctl.ok()},
                           "results": results, "wait": wait}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json", "X-Machine-Key": self.key})
        try:
            with urllib.request.urlopen(req, timeout=35) as r:
                return json.load(r)
        except Exception:
            with self.results_lock:              # keep unsent results for the next attempt
                self.results = results + self.results
            raise

    def run_command(self, c):
        kind, ok, err = c.get("type"), True, ""
        try:
            if kind in ("vend", "test_vend"):
                ok, err = self.ctl.vend(int(c["row"]), int(c["col"]))
            elif kind == "unlock":
                self.ctl.unlock(10)
            elif kind == "reboot":
                self.reboot_requested = True
            else:
                ok, err = False, "unknown command"
        except Exception as e:                   # noqa: BLE001
            ok, err = False, str(e)
        print(f"[agent] {kind} {c.get('slot', '')} -> {'ok' if ok else 'FAILED ' + err}")
        with self.results_lock:
            self.results.append({"id": c["id"], "ok": ok, "error": err})

    def telemetry_loop(self):
        """Reads sensors every 2 s; pushes door/tilt changes to the server straight away."""
        while True:
            st = self.ctl.status()
            changed = any(st.get(k) != self.telemetry.get(k) for k in ("door_open", "tilt"))
            self.telemetry = st
            if changed and st:
                try:
                    self.sync(wait=False)
                except Exception:                # noqa: BLE001 — main loop will retry
                    pass
            time.sleep(2)

    def run(self):
        threading.Thread(target=self.telemetry_loop, daemon=True).start()
        backoff = 1
        print(f"[agent] connecting to {self.url}")
        while True:
            try:
                reply = self.sync(wait=not self.results)
                backoff = 1
            except urllib.error.HTTPError as e:
                print(f"[agent] server refused ({e.code}) — check machine_key in config.json")
                time.sleep(15)
                continue
            except Exception as e:               # noqa: BLE001
                print(f"[agent] server unreachable: {e}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)
                continue
            lights = bool(reply.get("desired", {}).get("lights"))
            if lights != self.light:
                self.ctl.light_set(lights)
                self.light = lights
                print(f"[agent] lights {'ON' if lights else 'OFF'}")
            for c in reply.get("commands", []):
                self.run_command(c)
            if self.reboot_requested:
                try:
                    self.sync(wait=False)        # report the result before going down
                except Exception:                # noqa: BLE001
                    pass
                print("[agent] restarting machine")
                if isinstance(self.ctl, SimController):
                    self.reboot_requested = False
                else:
                    subprocess.run(["sudo", "/sbin/reboot"], check=False)
                    time.sleep(60)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    with open(args[0], encoding="utf-8") as f:
        cfg = json.load(f)
    Agent(cfg, "--simulate" in sys.argv).run()


if __name__ == "__main__":
    main()
