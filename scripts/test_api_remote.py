"""test_api_remote.py - End-to-end API test against the backend running on the Pi 5."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_config import connect_pi, REMOTE_BASE

import time
import requests

BASE_URL = f"http://{os.getenv('PI_HOST', '169.254.100.2')}:8000"

ASSEMBLY_CODE = """
.global _start
.text
_start:
    mov x0, #10
    mov x1, #20
    add x2, x0, x1
    mov x3, x2
    mov x8, #93
    mov x0, #0
    svc #0
"""


def main():
    # Restart the systemd service for a clean test run
    print("Restarting backend service on Pi...")
    ssh = connect_pi()
    ssh.exec_command("sudo systemctl restart arm64-visualizer.service")
    time.sleep(3)
    ssh.close()

    for i in range(15):
        try:
            r = requests.get(f"{BASE_URL}/api/health", timeout=2)
            if r.status_code == 200:
                print("Backend online!", r.json())
                break
        except Exception:
            time.sleep(1)
    else:
        print("Backend failed to respond in time.")
        return 1

    # 1. Build
    print("\n1. POST /api/build")
    r = requests.post(f"{BASE_URL}/api/build", json={"assembly_code": ASSEMBLY_CODE, "target_type": "standalone"}, timeout=15)
    build = r.json()
    print("   success:", build.get("success"), "| ELF:", build.get("executable_path"))
    assert build.get("success") is True, build

    # 2. Start debugger
    print("\n2. POST /api/debug/start")
    r = requests.post(f"{BASE_URL}/api/debug/start", timeout=15)
    print("   PC:", r.json().get("snapshot", {}).get("pc"))
    assert r.status_code == 200

    # 3. Step through three instructions
    expected = [(10, "X0"), (20, "X1"), (30, "X2")]
    for n, (val, reg) in enumerate(expected, 1):
        r = requests.post(f"{BASE_URL}/api/debug/step", timeout=15)
        ev = r.json()
        change = next((c for c in ev["changed_registers"] if c["reg"] == reg), None)
        print(f"   Step {n}: {ev.get('instruction')} -> {reg}={change['new_decimal'] if change else '??'}")
        assert change is not None and change["new_decimal"] == val

    # 4. Stop
    r = requests.post(f"{BASE_URL}/api/debug/stop", timeout=10)
    print("\n4. POST /api/debug/stop ->", r.json())

    print("\nEND-TO-END API TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
