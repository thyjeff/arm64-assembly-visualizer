#!/usr/bin/env bash
# setup_arm_device.sh - Bootstrap the ARM64 Visualizer backend on any
# AArch64 Linux device (Raspberry Pi 5, other SBCs, etc.).
#
# Usage (on the device):
#   git clone https://github.com/thyjeff/arm64-assembly-visualizer.git
#   cd arm64-assembly-visualizer
#   bash scripts/setup_arm_device.sh
#
# The portal is then served at http://<device-ip>:8000/ and other
# browsers can connect to it via the portal's "Connect Device" dialog.

set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="arm64-visualizer"

echo "==> ARM64 Assembly Visualizer - device setup"
echo "    App directory: $APP_DIR"

# 1. Toolchain + runtime packages
echo "==> [1/4] Installing assembler, linker, debugger and Python..."
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y build-essential gdb python3-venv python3-pip
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y gcc gcc-c++ binutils gdb python3-pip
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --needed --noconfirm base-devel gdb python-pip
else
  echo "    NOTE: unrecognized package manager - install gcc, binutils, gdb, python3 manually."
fi

# 2. Verify we are on AArch64 (the whole point of the project)
ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ]; then
  echo "    WARNING: this device reports '$ARCH', not 'aarch64'."
  echo "    The backend will run, but programs will not be native ARM64."
fi

# 3. Python virtual environment + dependencies
echo "==> [2/4] Creating Python virtual environment..."
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"

# 4. systemd service (auto-start at boot, restart on crash)
echo "==> [3/4] Installing systemd service..."
if [ -d /etc/systemd/system ]; then
  cat > "/tmp/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=ARM64 Assembly Visualizer Service
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir $APP_DIR/backend
Restart=always
RestartSec=3
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF
  sudo mv "/tmp/${SERVICE_NAME}.service" /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now "${SERVICE_NAME}.service"
  echo "    Service enabled and started."
else
  echo "    No systemd detected - start manually with:"
  echo "    $APP_DIR/venv/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir $APP_DIR/backend"
fi

# 5. Optional: hardware group permissions for GPIO/I2C/serial
echo "==> [4/4] Adding user to hardware groups (gpio, i2c, dialout)..."
if command -v usermod >/dev/null 2>&1; then
  sudo usermod -a -G gpio,i2c,dialout "$(whoami)" 2>/dev/null || true
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "==> Setup complete!"
echo "    Portal on this device : http://localhost:8000/"
echo "    Portal from other PCs : http://${IP:-<device-ip>}:8000/"
echo "    Connect other browsers to that URL via the 'Connect Device' dialog."
