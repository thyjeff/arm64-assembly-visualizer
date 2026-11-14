import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

class GPIOManager:
    """
    Safe GPIO helper for Raspberry Pi 5.
    Controls the external LED via Linux GPIO character device API (libgpiod).
    Defaults to OFF on init and ensures OFF on shutdown/cleanup.
    """
    def __init__(self, chip_path: str = "/dev/gpiochip4", pin_offset: int = 17):
        self.chip_path = chip_path
        self.pin_offset = pin_offset
        self.current_state = 0
        self.is_hardware_available = False
        self._request = None

        self._init_gpio()

    def _init_gpio(self):
        try:
            import gpiod
            from gpiod.line import Direction, Value

            # Attempt to open chip and request line
            # Raspberry Pi OS Trixie uses libgpiod v2 API
            try:
                # v2 API
                req = gpiod.request_lines(
                    self.chip_path,
                    consumer="arm64_visualizer",
                    config={
                        self.pin_offset: gpiod.LineSettings(
                            direction=Direction.OUTPUT,
                            output_value=Value.INACTIVE
                        )
                    }
                )
                self._request = req
                self.is_hardware_available = True
                logger.info(f"GPIO initialized on {self.chip_path} line {self.pin_offset} (libgpiod v2).")
            except Exception as e_v2:
                # Fallback to v1 API or shell gpioset if v2 is different
                logger.warning(f"libgpiod v2 init failed: {e_v2}, checking fallback.")
                self.is_hardware_available = False
        except ImportError:
            logger.info("gpiod module not found; running in simulated GPIO mode.")
            self.is_hardware_available = False

    def set_led(self, state: int) -> bool:
        """
        Sets LED state (1 = ON, 0 = OFF).
        """
        self.current_state = 1 if state else 0
        logger.info(f"[GPIO] Setting LED to {self.current_state}")

        # On Raspberry Pi 5, pinctrl directly latches the RP1 hardware pins
        try:
            import subprocess
            val = "dh" if self.current_state else "dl"
            subprocess.run(["pinctrl", "set", str(self.pin_offset), "op", val], capture_output=True, timeout=1)
            return True
        except Exception as e:
            logger.warning(f"pinctrl failed: {e}")

        if self.is_hardware_available and self._request:
            try:
                import gpiod
                from gpiod.line import Value
                val = Value.ACTIVE if self.current_state == 1 else Value.INACTIVE
                self._request.set_value(self.pin_offset, val)
                return True
            except Exception as e:
                logger.error(f"Failed to set GPIO line: {e}")
                return False
        return True

    def cleanup(self):
        """
        Turns off LED and releases GPIO line.
        """
        self.set_led(0)
        if self._request:
            try:
                self._request.release()
            except Exception:
                pass
            self._request = None
