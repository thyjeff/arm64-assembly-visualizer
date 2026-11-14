# ARM64 Assembly Architecture Visualizer

An educational **Computer Architecture demonstrator** that makes instruction execution visible: you write real ARM64 (AArch64) assembly in a browser portal, run it on a Raspberry Pi 5, and watch the **actual CPU registers change instruction-by-instruction** via GDB — while an Arduino-driven 16×2 LCD mirrors program output in the physical world.

> **Not an emulator.** Programs run natively on the Pi 5's Cortex-A76 cores; every register value shown comes from the real process via GDB/MI.

```text
                    WEB BROWSER (React + TypeScript)
       +--------------------------------------------------+
       | Assembly editor | Assemble | Run | Step (stepi)  |
       | Real registers  | ALU card | Execution timeline  |
       +------------------------+-------------------------+
                                | HTTP / WebSocket
       +------------------------v-------------------------+
       |                RASPBERRY PI 5                    |
       |  GNU as / ld  ->  native AArch64 ELF             |
       |  GDB/MI engine: stepi + register snapshots       |
       |  FastAPI + WebSocket broadcast                   |
       |  UDP bridge (127.0.0.1:9001) for program output  |
       +------------+---------------------+---------------+
                    |                     |
             USB serial             systemd 24/7
                    |                auto-start
       +------------v------------+
       |   ARDUINO UNO (CH340)   |
       |   line protocol + ACK   |
       +------------+------------+
                    | I2C (SDA/SCL)
       +------------v------------+
       |   16x2 I2C LCD (PCF8574)|
       |   "Hello World!"        |
       +-------------------------+
```

## Features

| Area | What it does |
| :--- | :--- |
| **Real execution** | GNU `as -g` + `ld` produce native AArch64 ELF binaries; no fake interpreter |
| **Instruction stepping** | GDB/MI `stepi` — exactly one machine instruction per click, before/after register snapshots with diffs |
| **Register viewer** | X0–X30, SP, PC, PSTATE flags (N/Z/C/V) in hex + decimal, changed registers highlighted |
| **ALU breakdown** | Educational card explaining operands, operation, and result target per step |
| **Execution timeline** | Every step captured; click a past step to inspect its snapshot |
| **Linux syscalls demo** | Create real text files on the Pi (`openat`/`write`/`close` in assembly) |
| **LCD output** | Assembly calls `lcd_print("Hello World!")` → UDP bridge → Arduino → 16×2 LCD |
| **Self-healing LCD** | Display re-initializes on demand; non-printable bytes are filtered before rendering |
| **24/7 operation** | systemd service with `Restart=always`, auto-starts on boot, auto-reconnects the Arduino |

## Repository Layout

```text
├── backend/                  # FastAPI application (runs on the Pi 5)
│   ├── app/
│   │   ├── main.py           # REST + WebSocket + UDP bridge
│   │   ├── builder.py        # GNU as/ld/gcc pipeline with smart linker selection
│   │   ├── gdb_engine.py     # GDB/MI controller (stepi, continue, snapshots, diffs)
│   │   ├── schemas.py        # Pydantic models
│   │   ├── config.py         # Ports, GPIO, serial configuration
│   │   └── hardware/
│   │       ├── gpio_manager.py   # Safe GPIO helper (pinctrl/libgpiod, BCM 17)
│   │       ├── serial_lcd.py     # Arduino serial publisher with ACK verification
│   │       └── gpio_helper.c     # C helpers linked into user programs
│   │                            #   (led_set, delay_ms, lcd_print)
│   └── run_server.py
├── frontend/                 # React + TypeScript + Vite portal
│   └── src/
│       ├── App.tsx
│       ├── components/       # Editor, RegisterViewer, ControlToolbar,
│       │                     # AluVisualizer, ExecutionTimeline
│       └── types/debugger.ts
├── arduino/
│   └── lcd_monitor/          # Arduino Uno firmware (serial line protocol + ACKs)
├── examples/                 # Ready-to-run AArch64 assembly demos
│   ├── 01_arithmetic.s       # MOV/ADD/SUB/MUL/CMP + clean exit
│   ├── 02_arithmetic_c_driver.c
│   ├── 03_gpio_led.s         # AAPCS64 calls to led_set()
│   └── 04_create_file.s      # Real file creation via Linux syscalls
└── scripts/                  # Dev tooling (credentials via env vars - see below)
    ├── pi_config.py          # Shared SSH config (PI_HOST/PI_USER/PI_PASSWORD)
    ├── pi_preflight.py       # Milestone 0 environment check
    ├── stk500_upload.py      # Dependency-free STK500v1 flasher with verify
    ├── verify_all.py         # Full-system verification suite
    └── remote_m1_runner.py   # Milestone 1 acceptance test (runs on the Pi)
```

## Quick Start

### 1. Backend on the Raspberry Pi 5

```bash
# One-time setup (Debian/Raspberry Pi OS 64-bit)
sudo apt install build-essential gdb python3-venv
python3 -m venv ~/arm64_visualizer/venv
~/arm64_visualizer/venv/bin/pip install fastapi uvicorn pydantic pyserial websockets

# Run (development)
~/arm64_visualizer/venv/bin/python3 -m uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 --app-dir ~/arm64_visualizer/backend

# Production: install the provided systemd unit
sudo cp deploy/arm64-visualizer.service /etc/systemd/system/
sudo systemctl enable --now arm64-visualizer.service
```

The portal is served directly at `http://<pi-ip>:8000/`.

### 2. Frontend (development)

```bash
cd frontend
npm install
npm run dev          # proxies /api and /ws to the Pi
```

### 3. Arduino firmware

```bash
# Using arduino-cli (or the Arduino IDE)
arduino-cli lib install "LiquidCrystal I2C"
arduino-cli compile --fqbn arduino:avr:uno arduino/lcd_monitor
arduino-cli upload  --fqbn arduino:avr:uno -p <PORT> --input-dir arduino/build
```

Wiring the LCD backpack to the Uno: `GND→GND`, `VCC→5V`, `SDA→A4`, `SCL→A5`.
Then connect the Uno to the Pi over USB — it is auto-detected (`/dev/ttyACM0` or `/dev/ttyUSB0`).

## Developer Scripts

All SSH scripts read credentials from **environment variables** — nothing is hardcoded:

```bash
export PI_HOST=169.254.100.2     # your Pi's address
export PI_USER=pi
export PI_PASSWORD=********      # keep out of the repo!

python scripts/pi_preflight.py   # Milestone 0 environment check
python scripts/verify_all.py     # full-system verification suite
```

## API Summary

| Endpoint | Purpose |
| :--- | :--- |
| `POST /api/build` | Assemble + link submitted assembly into an ELF |
| `POST /api/debug/start` | Launch GDB, break at `main`/`_start` |
| `POST /api/debug/step` | Execute exactly one instruction, return register diff |
| `POST /api/debug/continue` | Run to completion |
| `POST /api/debug/stop` | Terminate session safely |
| `GET /api/debug/state` | Current session state + history |
| `POST /api/gpio/led` | Drive BCM 17 (through the safe helper) |
| `POST /api/lcd/test` | Arduino round-trip health check (`PING`→`PONG`) |
| `WS /ws/session` | Live step events for the portal |

## Hardware Notes & Safety

- **Pi 5 GPIO is 3.3 V only, not 5 V tolerant.** The LED path uses a 330 Ω series resistor on BCM 17 (header pin 11).
- The LCD lives on the **Arduino side** (5 V), communicating with the Pi over USB — electrically isolated from Pi GPIO.
- The debugged program never touches `/dev/ttyACM0` directly; it talks to the backend over a localhost UDP bridge, avoiding stray DTR resets mid-session.
- On Pi 5 the RP1 controller is managed via `pinctrl` (no legacy BCM2835 register addresses).

## Verification

`scripts/verify_all.py` checks the whole chain: systemd service, portal, Arduino round-trip, assemble/step/flag accuracy (X0=10, X1=20, X2=30, Z-flag set by `cmp`), run-to-completion, and LCD message delivery.

## License

MIT — see [LICENSE](LICENSE).
