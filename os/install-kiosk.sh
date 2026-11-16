#!/usr/bin/env bash
# CampusVend kiosk installer for the Raspberry Pi inside each machine.
# Tested target: Raspberry Pi OS Lite (64-bit, Bookworm or newer) on Pi 4 / Pi 5.
#
#   1. Flash Raspberry Pi OS Lite with Raspberry Pi Imager (set hostname, enable SSH, add Wi-Fi if no LAN).
#   2. Copy this whole "campusvend" folder to the Pi, then run:
#        sudo bash os/install-kiosk.sh  http://SERVER:8080  MACHINE_KEY
#
# What it does: installs Chromium + the "cage" kiosk compositor + pyserial, installs the machine
# agent as a service, and boots straight into the full-screen kiosk UI (no desktop, no login).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }
SERVER_URL="${1:?usage: install-kiosk.sh SERVER_URL MACHINE_KEY}"
MACHINE_KEY="${2:?usage: install-kiosk.sh SERVER_URL MACHINE_KEY}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y cage wlr-randr python3-serial unattended-upgrades
apt-get install -y chromium || apt-get install -y chromium-browser
CHROME="$(command -v chromium || command -v chromium-browser)"

id kiosk &>/dev/null || useradd -m -s /usr/sbin/nologin kiosk
usermod -aG dialout,video,input,render kiosk

install -d -m 750 -o kiosk -g kiosk /opt/campusvend
install -m 755 "$SRC/agent/vmc_agent.py" /opt/campusvend/vmc_agent.py
# config.json holds the machine key: readable only by the kiosk user
umask 077
cat > /opt/campusvend/config.json <<EOF
{ "server_url": "$SERVER_URL", "machine_key": "$MACHINE_KEY", "serial_port": "/dev/ttyACM0" }
EOF
cat > /opt/campusvend/kiosk-browser.sh <<EOF
#!/bin/sh
# Portrait screen: uncomment and set your output name (run "wlr-randr" to list outputs).
# wlr-randr --output HDMI-A-1 --transform 90
KEY=\$(python3 -c "import json;print(json.load(open('/opt/campusvend/config.json'))['machine_key'])")
exec $CHROME --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate \\
  --disable-pinch --overscroll-history-navigation=0 --check-for-update-interval=31536000 \\
  --ozone-platform=wayland "$SERVER_URL/kiosk/#key=\$KEY"
EOF
chmod 750 /opt/campusvend/kiosk-browser.sh
chown -R kiosk:kiosk /opt/campusvend
umask 022

# Allow only the reboot command without a password (used by "Restart machine" in the admin portal).
echo 'kiosk ALL=(root) NOPASSWD: /sbin/reboot' > /etc/sudoers.d/campusvend
chmod 440 /etc/sudoers.d/campusvend

install -m 644 "$SRC/os/campusvend-agent.service" /etc/systemd/system/
install -m 644 "$SRC/os/campusvend-kiosk.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable campusvend-agent.service campusvend-kiosk.service
systemctl set-default graphical.target
systemctl disable getty@tty1.service || true

# Hardware watchdog: the Pi restarts itself if it ever freezes.
grep -q '^RuntimeWatchdogSec' /etc/systemd/system.conf || echo 'RuntimeWatchdogSec=15' >> /etc/systemd/system.conf

echo
echo "Done. Reboot now:  sudo reboot"
echo "After reboot the screen shows the kiosk and the machine appears as Online in the admin portal."
