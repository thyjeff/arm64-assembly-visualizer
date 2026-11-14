"""pi_preflight.py - Verify the Raspberry Pi 5 environment over SSH (Milestone 0)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_config import connect_pi, PI_HOST, PI_USER


def run_preflight():
    print(f"Connecting to Raspberry Pi at {PI_HOST} as user '{PI_USER}'...")
    client = connect_pi()
    print("Connected successfully!\n" + "=" * 50)

    commands = [
        ("Architecture", "uname -m"),
        ("Bitness", "getconf LONG_BIT"),
        ("Kernel Release", "uname -r"),
        ("OS Info", "grep -E '^(PRETTY_NAME|NAME|VERSION)=' /etc/os-release"),
        ("GCC Target", "gcc -dumpmachine"),
        ("GCC Version", "gcc --version | head -n 1"),
        ("Assembler (as)", "as --version | head -n 1"),
        ("Linker (ld)", "ld --version | head -n 1"),
        ("Debugger (gdb)", "gdb --version | head -n 1"),
        ("Python3 Version", "python3 --version"),
        ("Serial Devices", "ls -la /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || echo 'No USB serial devices detected'"),
        ("GPIO Chips", "ls -la /dev/gpiochip* 2>/dev/null || echo 'No gpiochips found'"),
        ("libgpiod tools", "which gpiodetect gpioinfo gpioset gpioget || echo 'gpiod tools not found'"),
    ]

    for title, cmd in commands:
        _, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        print(f"[{title}]: {cmd}")
        if out:
            print(out)
        if err:
            print(f"STDERR: {err}")
        print("-" * 50)

    client.close()


if __name__ == "__main__":
    run_preflight()
