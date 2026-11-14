import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR / "workspace"
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

# Server Configuration
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))

# Hardware Configuration (Raspberry Pi 5)
# Pi 5 RP1 chip is commonly gpiochip0 (aliased to gpiochip4)
GPIO_CHIP = os.getenv("GPIO_CHIP", "/dev/gpiochip4")
LED_GPIO_PIN = int(os.getenv("LED_GPIO_PIN", "17")) # BCM 17 (Header Pin 11)

# Arduino USB Serial
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
SERIAL_BAUDRATE = int(os.getenv("SERIAL_BAUDRATE", "115200"))
SERIAL_ENABLED = os.getenv("SERIAL_ENABLED", "true").lower() == "true"

# Debugger limits
GDB_TIMEOUT_SEC = 5.0
MAX_INSTRUCTIONS_PER_RUN = 500
