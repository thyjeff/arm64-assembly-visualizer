import serial
import time

try:
    ser = serial.Serial('/dev/ttyACM0', 115200, timeout=1.5)
    time.sleep(1.8)
    print("Serial port /dev/ttyACM0 opened successfully!")
    ser.write(b"INST|HELLO PI5\n")
    ser.write(b"REG|X0|10\n")
    print("Successfully sent test lines to Arduino over USB Serial!")
    resp = ser.readline().decode('utf-8', errors='replace').strip()
    if resp:
        print("Arduino reply:", resp)
    ser.close()
except Exception as e:
    print("Error:", e)
