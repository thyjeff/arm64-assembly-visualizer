import logging
import time
import glob
from typing import Optional

logger = logging.getLogger(__name__)

class SerialLCDPublisher:
    """
    Publishes concise execution and hardware updates to Arduino LCD over USB serial.
    Every line sent is acknowledged by the Arduino ("ACK|<CMD>"), which is
    logged for end-to-end verification.

    Auto-detects the port: official Arduino Uno (ATmega16U2) enumerates as
    /dev/ttyACM0, CH340-based clones enumerate as /dev/ttyUSB0.
    """
    def __init__(self, port: str = "/dev/ttyACM0", baudrate: int = 115200, enabled: bool = True):
        self.port = port
        self.baudrate = baudrate
        self.enabled = enabled
        self.serial_conn = None
        self.is_connected = False
        self._last_connect_attempt = 0.0

        if self.enabled:
            self._connect()

    @staticmethod
    def _detect_port() -> Optional[str]:
        """Return the first plausible Arduino serial port, preferring ttyACM."""
        for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*"):
            matches = sorted(glob.glob(pattern))
            if matches:
                return matches[0]
        return None

    def _connect(self):
        self._last_connect_attempt = time.time()
        try:
            import serial as pyserial
            # Prefer the configured port if it exists, otherwise auto-detect
            target = self.port if glob.glob(self.port) else self._detect_port()
            if not target:
                logger.info("No Arduino serial device found (checked /dev/ttyACM*, /dev/ttyUSB*).")
                self.is_connected = False
                return
            self.serial_conn = pyserial.Serial(target, self.baudrate, timeout=1.0)
            time.sleep(1.5)  # Wait for Arduino reset on DTR assert
            self.serial_conn.reset_input_buffer()  # Drop any stale boot messages
            self.is_connected = True
            self.port = target
            logger.info(f"Connected to Arduino on {target} at {self.baudrate} baud.")
        except Exception as e:
            logger.info(f"Arduino serial connection not available ({e}); running in simulated mode.")
            self.is_connected = False

    def _try_reconnect(self):
        """Lazy reconnect, throttled to one attempt every 5 seconds."""
        if time.time() - self._last_connect_attempt < 5.0:
            return
        self._last_connect_attempt = time.time()
        logger.info(f"[LCD] Attempting reconnect to Arduino on {self.port}...")
        self._connect()

    def _read_ack(self, timeout: float = 0.12) -> str:
        """Short read of the Arduino's acknowledgement line."""
        try:
            self.serial_conn.timeout = timeout
            line = self.serial_conn.readline().decode('utf-8', errors='replace').strip()
            self.serial_conn.timeout = 1.0
            return line
        except Exception:
            try:
                self.serial_conn.timeout = 1.0
            except Exception:
                pass
            return ""

    def send_line(self, line: str):
        if not self.is_connected:
            self._try_reconnect()

        if self.is_connected and self.serial_conn:
            try:
                msg = (line.strip() + "\n").encode('utf-8')
                self.serial_conn.write(msg)
                self.serial_conn.flush()
                logger.info(f"[LCD SEND] {line.strip()}")
                ack = self._read_ack()
                if ack:
                    logger.info(f"[LCD ACK] {ack}")
            except Exception as e:
                logger.error(f"Error writing to serial: {e}")
                self.is_connected = False
        else:
            logger.debug(f"[LCD SIM]: {line.strip()}")

    def ping(self) -> Optional[str]:
        """
        Round-trip health check: sends PING and expects PONG|ARM64-LCD.
        Returns the Arduino's reply string, or None on failure.
        """
        if not self.is_connected:
            self._try_reconnect()

        if not self.is_connected or not self.serial_conn:
            logger.warning("[LCD PING] Arduino not connected.")
            return None

        try:
            self.serial_conn.reset_input_buffer()
            self.serial_conn.write(b"PING\n")
            self.serial_conn.flush()
            self.serial_conn.timeout = 1.0
            reply = self.serial_conn.readline().decode('utf-8', errors='replace').strip()
            if reply:
                logger.info(f"[LCD PING] -> {reply}")
            else:
                logger.warning("[LCD PING] No reply from Arduino.")
            return reply if reply else None
        except Exception as e:
            logger.error(f"[LCD PING] failed: {e}")
            return None

    def send_instruction(self, instruction: str):
        self.send_line(f"INST|{instruction}")

    def send_register(self, reg: str, value: str):
        self.send_line(f"REG|{reg}|{value}")

    def send_gpio(self, state_str: str):
        self.send_line(f"GPIO|{state_str}")

    def send_state(self, state: str):
        self.send_line(f"STATE|{state}")

    def clear(self):
        self.send_line("CLEAR")

    def close(self):
        if self.serial_conn:
            try:
                self.serial_conn.close()
            except Exception:
                pass
            self.is_connected = False
