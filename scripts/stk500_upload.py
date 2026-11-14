#!/usr/bin/env python3
"""
stk500_upload.py - Minimal STK500v1 (Optiboot) uploader for Arduino Uno R3.

Runs on the Raspberry Pi 5 and flashes an Intel HEX file onto the ATmega328P
over /dev/ttyACM0 using pyserial only (no avrdude required).

Flow:
  1. Pulse DTR to reset the board into the Optiboot bootloader.
  2. Sync with the bootloader (0x30 GET_SYNC).
  3. Read device signature (0x75) and verify it is an ATmega328P.
  4. Program every 128-byte flash page (0x55 LOAD_ADDRESS + 0x64 PROG_PAGE).
  5. Read every page back (0x74 READ_PAGE) and verify byte-for-byte.
  6. Leave programming mode (0x51) and print any boot messages from the sketch.

Usage:
  python3 stk500_upload.py <hexfile> [port]

Defaults: port=/dev/ttyACM0
"""

import sys
import time

import serial

STK_INSYNC = 0x14
STK_OK = 0x10
CRC_EOP = 0x20

CMD_SYNC = 0x30
CMD_LEAVE_PROGMODE = 0x51
CMD_LOAD_ADDRESS = 0x55
CMD_PROG_PAGE = 0x64
CMD_READ_PAGE = 0x74
CMD_READ_SIGN = 0x75

PAGE_SIZE = 128          # ATmega328P flash page size (bytes)
ATMEGA328P_SIGNATURE = [0x1E, 0x95, 0x0F]


def parse_ihex(path):
    """Parse an Intel HEX file into a flat flash image (padded with 0xFF)."""
    image = bytearray()
    ext_base = 0
    with open(path) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or not line.startswith(':'):
                continue
            count = int(line[1:3], 16)
            addr = int(line[3:7], 16)
            rtype = int(line[7:9], 16)
            data = bytes.fromhex(line[9:9 + 2 * count])
            if rtype == 0x00:  # data record
                start = ext_base + addr
                if start + count > len(image):
                    image.extend(b'\xff' * (start + count - len(image)))
                image[start:start + count] = data
            elif rtype == 0x01:  # EOF
                break
            elif rtype == 0x04:  # extended linear address
                ext_base = int.from_bytes(data, 'big') << 16
    return bytes(image)


class STK500:
    def __init__(self, port):
        self.ser = serial.Serial(port, 115200, timeout=1.0)

    def close(self):
        self.ser.close()

    def reset(self):
        """Pulse DTR so the 16U2 resets the ATmega328P into Optiboot."""
        self.ser.setDTR(False)
        self.ser.setRTS(False)
        time.sleep(0.1)
        self.ser.setDTR(True)
        time.sleep(0.1)
        self.ser.setDTR(False)
        self.ser.reset_input_buffer()

    def _expect_insync_ok(self, timeout=1.5):
        deadline = time.time() + timeout
        buf = b''
        while time.time() < deadline and len(buf) < 2:
            chunk = self.ser.read(2 - len(buf))
            if chunk:
                buf += chunk
        return len(buf) == 2 and buf[0] == STK_INSYNC and buf[1] == STK_OK, buf

    def sync(self, rounds=3):
        """Reset the board and try to catch the Optiboot sync window."""
        for attempt in range(1, rounds + 1):
            self.reset()
            deadline = time.time() + 3.0
            while time.time() < deadline:
                self.ser.write(bytes([CMD_SYNC, CRC_EOP]))
                r = self.ser.read(2)
                if len(r) == 2 and r[0] == STK_INSYNC and r[1] == STK_OK:
                    return True
                time.sleep(0.03)
            print(f"  sync attempt {attempt}/{rounds} failed, retrying...")
        return False

    def read_signature(self):
        self.ser.write(bytes([CMD_READ_SIGN, CRC_EOP]))
        r = self.ser.read(5)
        if len(r) == 5 and r[0] == STK_INSYNC and r[4] == STK_OK:
            return list(r[1:4])
        raise RuntimeError(f"Signature read failed, got: {r.hex()}")

    def load_address(self, word_addr):
        self.ser.write(bytes([CMD_LOAD_ADDRESS,
                              word_addr & 0xFF,
                              (word_addr >> 8) & 0xFF,
                              CRC_EOP]))
        ok, r = self._expect_insync_ok()
        if not ok:
            raise RuntimeError(f"load_address({word_addr:#x}) failed: {r.hex()}")

    def prog_page(self, byte_addr, data):
        self.load_address(byte_addr // 2)
        cmd = bytes([CMD_PROG_PAGE,
                     (PAGE_SIZE >> 8) & 0xFF,
                     PAGE_SIZE & 0xFF,
                     0x46]) + data + bytes([CRC_EOP])  # 0x46 = 'F' (flash)
        self.ser.write(cmd)
        ok, r = self._expect_insync_ok()
        if not ok:
            raise RuntimeError(f"prog_page({byte_addr:#x}) failed: {r.hex()}")

    def read_page(self, byte_addr):
        self.load_address(byte_addr // 2)
        cmd = bytes([CMD_READ_PAGE,
                     (PAGE_SIZE >> 8) & 0xFF,
                     PAGE_SIZE & 0xFF,
                     0x46,
                     CRC_EOP])
        self.ser.write(cmd)
        expected = 2 + PAGE_SIZE  # INSYNC + data + OK
        buf = self.ser.read(expected)
        if len(buf) == expected and buf[0] == STK_INSYNC and buf[-1] == STK_OK:
            return buf[1:1 + PAGE_SIZE]
        raise RuntimeError(f"read_page({byte_addr:#x}) failed: got {len(buf)} bytes")

    def leave(self):
        self.ser.write(bytes([CMD_LEAVE_PROGMODE, CRC_EOP]))
        ok, _ = self._expect_insync_ok()
        return ok


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 stk500_upload.py <hexfile> [port]")
        sys.exit(2)

    hexfile = sys.argv[1]
    port = sys.argv[2] if len(sys.argv) > 2 else '/dev/ttyACM0'

    image = parse_ihex(hexfile)
    if len(image) == 0:
        print("ERROR: HEX file contains no flash data!")
        sys.exit(1)

    # Pad image to a full page boundary
    if len(image) % PAGE_SIZE:
        image += b'\xff' * (PAGE_SIZE - len(image) % PAGE_SIZE)

    num_pages = len(image) // PAGE_SIZE
    print(f"HEX file: {hexfile}")
    print(f"Image size: {len(image)} bytes -> {num_pages} pages of {PAGE_SIZE} bytes")
    print(f"Target: {port} @ 115200 baud")

    try:
        uploader = STK500(port)
    except Exception as e:
        print(f"ERROR: Could not open {port}: {e}")
        sys.exit(1)

    print("\n[1/6] Resetting board and syncing with Optiboot bootloader...")
    if not uploader.sync():
        print("ERROR: Could not sync with bootloader.")
        print("  - Check that no other process is using the serial port.")
        print("  - Unplug/replug the Arduino and try again.")
        sys.exit(1)
    print("  Sync OK (STK500v1 / Optiboot).")

    print("\n[2/6] Reading device signature...")
    sig = uploader.read_signature()
    print(f"  Signature: {sig[0]:02X} {sig[1]:02X} {sig[2]:02X}", end='')
    if sig == ATMEGA328P_SIGNATURE:
        print("  (ATmega328P confirmed)")
    else:
        print("  WARNING: not the expected ATmega328P signature (1E 95 0F)!")

    print(f"\n[3/6] Programming {num_pages} flash pages...")
    for page in range(num_pages):
        byte_addr = page * PAGE_SIZE
        uploader.prog_page(byte_addr, image[byte_addr:byte_addr + PAGE_SIZE])
        if (page + 1) % 8 == 0 or page == num_pages - 1:
            print(f"  wrote {page + 1}/{num_pages} pages")

    print(f"\n[4/6] Verifying {num_pages} pages (read-back compare)...")
    all_ok = True
    for page in range(num_pages):
        byte_addr = page * PAGE_SIZE
        readback = uploader.read_page(byte_addr)
        if readback != image[byte_addr:byte_addr + PAGE_SIZE]:
            all_ok = False
            print(f"  VERIFY MISMATCH at page {page} (addr {byte_addr:#06x})!")
    if not all_ok:
        print("ERROR: Flash verification FAILED.")
        sys.exit(1)
    print(f"  VERIFY OK: all {num_pages} pages match byte-for-byte.")

    print("\n[5/6] Leaving programming mode...")
    if uploader.leave():
        print("  Bootloader exited cleanly.")
    else:
        print("  WARNING: no clean response to leave-progmode (continuing).")

    print("\n[6/6] Listening for sketch boot messages...")
    deadline = time.time() + 3.0
    received = []
    while time.time() < deadline:
        line = uploader.ser.readline().decode('utf-8', errors='replace').strip()
        if line:
            received.append(line)
            print(f"  Arduino says: {line}")
    if not received:
        print("  (no message received; sketch may have started before we listened)")

    uploader.close()

    print("\n" + "=" * 60)
    print("SUCCESS: Arduino Uno flashed AND verified byte-for-byte!")
    print("=" * 60)


if __name__ == '__main__':
    main()
