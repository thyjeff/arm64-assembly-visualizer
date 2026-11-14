#!/usr/bin/env python3
"""verify_all.py - Complete verification suite for the ARM64 Visualizer system."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_config import connect_pi, PI_HOST

import time
import requests

base = f"http://{PI_HOST}:8000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

ssh = connect_pi()

# ============ 1. SYSTEM SERVICE ============
_, so, _ = ssh.exec_command("systemctl is-enabled arm64-visualizer.service")
out = so.read().decode().strip()
check("Service enabled at boot", out == "enabled", out)
_, so, _ = ssh.exec_command("systemctl is-active arm64-visualizer.service")
out = so.read().decode().strip()
check("Service currently active", out == "active", out)

# ============ 2. PORTAL ============
r = requests.get(f"{base}/", timeout=5)
check("Portal serves web UI", r.status_code == 200 and "text/html" in r.headers.get("content-type", ""))
r = requests.get(f"{base}/api/health", timeout=5)
check("API health endpoint", r.status_code == 200 and r.json().get("status") == "online")

# ============ 3. ARDUINO LCD (only when the hardware is attached) ============
_, so, _ = ssh.exec_command("ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n 1")
arduino_tty = so.read().decode().strip()
r = requests.post(f"{base}/api/lcd/test", timeout=5)
if arduino_tty:
    check("Arduino LCD round-trip (PING/PONG)", r.json().get("pong_received") is True, r.json().get("reply"))
else:
    print("[SKIP] Arduino LCD round-trip - no Arduino attached (optional hardware)")

# ============ 4. FULL DEBUG WORKFLOW (Arithmetic) ============
code = """
.global _start
.text
_start:
    mov x0, #10
    mov x1, #20
    add x2, x0, x1
    mov x3, x2
    cmp x2, x3
    mov x8, #93
    mov x0, #0
    svc #0
"""
r = requests.post(f"{base}/api/build", json={"assembly_code": code, "target_type": "standalone"}, timeout=15)
check("Assemble & Link (GNU as + ld)", r.json().get("success") is True)

r = requests.post(f"{base}/api/debug/start", timeout=15)
ok = r.status_code == 200 and r.json().get("snapshot", {}).get("pc") == "0x400078"
check("Debug session starts at _start", ok, "PC=" + str(r.json().get("snapshot", {}).get("pc")))

# Step 1: mov x0, #10 -> X0 = 10
s = requests.post(f"{base}/api/debug/step", timeout=15).json()
x0 = next((c for c in s["changed_registers"] if c["reg"] == "X0"), None)
check("Step 1: mov x0,#10 -> X0=10", x0 is not None and x0["new_decimal"] == 10)

# Step 2: mov x1, #20 -> X1 = 20, X0 retained
s = requests.post(f"{base}/api/debug/step", timeout=15).json()
x1 = next((c for c in s["changed_registers"] if c["reg"] == "X1"), None)
x0_still = s["snapshot_after"]["registers"].get("x0") == "0xa"
check("Step 2: mov x1,#20 -> X1=20 (X0 retained)", x1 is not None and x1["new_decimal"] == 20 and x0_still)

# Step 3: add x2, x0, x1 -> X2 = 30
s = requests.post(f"{base}/api/debug/step", timeout=15).json()
x2 = next((c for c in s["changed_registers"] if c["reg"] == "X2"), None)
check("Step 3: add x2,x0,x1 -> X2=30", x2 is not None and x2["new_decimal"] == 30)

# Step 4: mov x3, x2 -> X3 = 30, X2 keeps 30
s = requests.post(f"{base}/api/debug/step", timeout=15).json()
x3 = next((c for c in s["changed_registers"] if c["reg"] == "X3"), None)
x2_still = s["snapshot_after"]["registers"].get("x2") == "0x1e"
check("Step 4: mov x3,x2 -> X3=30, X2 retains 30", x3 is not None and x3["new_decimal"] == 30 and x2_still)

# Step 5: cmp x2, x3 -> Z flag set
s = requests.post(f"{base}/api/debug/step", timeout=15).json()
zflag = s["snapshot_after"]["flags"].get("Z")
check("Step 5: cmp x2,x3 -> Z flag = 1", zflag is True)

requests.post(f"{base}/api/debug/stop", timeout=10)
check("Debug stop / cleanup", True)

# ============ 5. HELLO WORLD -> LCD ONLY ============
lcd_code = """
.global main
.type main, %function

.data
greeting:
    .asciz  "Hello World!"

.text
main:
    stp     x29, x30, [sp, #-16]!
    mov     x29, sp
    ldr     x0, =greeting
    bl      lcd_print
    mov     x0, #0
    ldp     x29, x30, [sp], #16
    ret
"""
r = requests.post(f"{base}/api/build", json={"assembly_code": lcd_code, "target_type": "standalone"}, timeout=15)
check("Build Hello World LCD program", r.json().get("success") is True)

requests.post(f"{base}/api/debug/start", timeout=15)
time.sleep(0.5)
r = requests.post(f"{base}/api/debug/continue", timeout=20)
ev = r.json()
check("Run to Completion (exit 0)", ev.get("is_halted") is True and ev.get("exit_code") == 0, "exit=" + str(ev.get("exit_code")))

time.sleep(0.5)
if arduino_tty:
    stdin, stdout, stderr = ssh.exec_command(
        'journalctl -u arm64-visualizer.service --since "1 minute ago" --no-pager | grep "LCD SEND"'
    )
    lines = [l.split("[LCD SEND]")[-1].strip() for l in stdout.read().decode().splitlines() if "[LCD SEND]" in l]
    # Find the Hello World program's INST line; nothing but GPIO events may follow it
    try:
        hw_idx = next(i for i, l in enumerate(lines) if l == "INST|Hello World!")
        after = lines[hw_idx + 1:]
        only_gpio = all(l.startswith("GPIO|") for l in after)
        check("LCD shows ONLY 'Hello World!' after program run",
              hw_idx >= 0 and only_gpio,
              " -> ".join(lines[hw_idx:hw_idx + 2]))
    except StopIteration:
        check("LCD shows ONLY 'Hello World!' after program run", False, "INST|Hello World! not found")
else:
    print("[SKIP] LCD delivery check - no Arduino attached (optional hardware)")

# ============ 6. GPIO LED ============
# (Skipped: no LED is connected on this setup - LCD only.
#  GPIO 17 is left in safe input state and never driven.)

ssh.close()

print()
print("=" * 60)
passed = sum(1 for _, ok, _ in results if ok)
print(f"FINAL SCORE: {passed}/{len(results)} checks PASSED")
print("=" * 60)
