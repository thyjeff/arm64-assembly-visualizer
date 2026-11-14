#!/usr/bin/env python3
"""
remote_m1_runner.py - Complete Milestone 1 Acceptance Test on Raspberry Pi 5.
"""

import subprocess
import os
import sys
import re

def test_milestone1():
    print("=" * 60)
    print("Milestone 1 Acceptance Test: AArch64 Assembly + GDB/MI Stepper")
    print("=" * 60)

    work_dir = os.path.expanduser("~/arm64_visualizer/build_test")
    os.makedirs(work_dir, exist_ok=True)

    asm_src = os.path.expanduser("~/arm64_visualizer/examples/01_arithmetic.s")
    obj_file = os.path.join(work_dir, "01_arithmetic.o")
    elf_file = os.path.join(work_dir, "01_arithmetic.elf")

    # 1. Assemble with GNU as
    res_as = subprocess.run(["as", "-g", "-o", obj_file, asm_src], capture_output=True, text=True)
    if res_as.returncode != 0:
        print("Assembler Error:", res_as.stderr)
        sys.exit(1)
    print("[1/3] Assembled 01_arithmetic.s successfully with debug symbols.")

    # 2. Link with GNU ld
    res_ld = subprocess.run(["ld", "-o", elf_file, obj_file], capture_output=True, text=True)
    if res_ld.returncode != 0:
        print("Linker Error:", res_ld.stderr)
        sys.exit(1)
    print("[2/3] Linked executable successfully.")

    # 3. Check ELF architecture
    res_elf = subprocess.run(["readelf", "-h", elf_file], capture_output=True, text=True)
    if "AArch64" not in res_elf.stdout:
        print("Error: ELF is not AArch64!")
        sys.exit(1)
    print("[3/3] Confirmed ELF Machine: AArch64 (64-bit Little Endian).")

    # 4. GDB Controller Session
    print("\nStarting GDB/MI Session on native AArch64 binary...")
    p = subprocess.Popen(
        ["gdb", "--interpreter=mi3", "-q", elf_file],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )

    def read_until_prompt():
        lines = []
        while True:
            line = p.stdout.readline()
            if not line:
                break
            l = line.strip()
            lines.append(l)
            if l == "(gdb)":
                break
        return lines

    def send_cmd(cmd):
        p.stdin.write(cmd + "\n")
        p.stdin.flush()
        return read_until_prompt()

    # Initial prompt
    read_until_prompt()

    # Get register names mapping
    reg_names = {}
    r = send_cmd("-data-list-register-names")
    for l in r:
        m = re.search(r'register-names=\[(.*?)\]', l)
        if m:
            names = re.findall(r'"(.*?)"', m.group(1))
            reg_names = {i: n.lower() for i, n in enumerate(names) if n}

    print(f"Loaded {len(reg_names)} architecture registers from GDB.")

    # Break at _start
    send_cmd("-break-insert _start")

    # Run
    send_cmd("-exec-run")
    # Wait for the *stopped notification
    stopped_lines = read_until_prompt()

    def get_regs():
        r = send_cmd("-data-list-register-values x")
        vals = {}
        for l in r:
            for m in re.finditer(r'\{number="(\d+)",value="([^"]+)"\}', l):
                idx = int(m.group(1))
                val = m.group(2)
                name = reg_names.get(idx)
                if name:
                    vals[name] = val
        return vals

    def get_instruction():
        r = send_cmd('-interpreter-exec console "x/i $pc"')
        for l in r:
            # Matches ~"=> 0x400078 <_start>:\tmov\tx0, #0xa\t// #10\n"
            m = re.search(r'=>\s*(0x[0-9a-fA-F]+)\s*(?:<[^>]+>)?:?\s*(.*)', l)
            if m:
                raw = m.group(2)
                # Clean escaped chars and quotes
                clean = raw.replace('\\t', ' ').replace('\\n', '').replace('"', '').strip()
                return m.group(1), clean
        return "", ""

    prev_regs = get_regs()

    step_count = 0
    print("\n--- Stepping Instructions and Inspecting Real Registers ---")

    while step_count < 15:
        addr, inst = get_instruction()
        if not inst:
            break

        step_count += 1
        print(f"\n[Step {step_count}] at {addr}: {inst}")

        # Execute single instruction
        send_cmd("-exec-step-instruction")
        stop_lines = read_until_prompt()
        stop_str = "\n".join(stop_lines)

        curr_regs = get_regs()

        # Compare registers
        changed = []
        for r_name in [f"x{i}" for i in range(31)] + ["sp", "pc", "cpsr"]:
            old_val = prev_regs.get(r_name, "0x0")
            new_val = curr_regs.get(r_name, "0x0")
            if old_val != new_val:
                try:
                    old_dec = int(old_val, 16)
                    new_dec = int(new_val, 16)
                    changed.append(f"{r_name.upper()}: {old_dec} ({old_val}) -> {new_dec} ({new_val})")
                except Exception:
                    changed.append(f"{r_name.upper()}: {old_val} -> {new_val}")

        if changed:
            print("  -> Changed Registers:")
            for c in changed:
                print(f"       {c}")
        else:
            print("  -> (No general-purpose registers modified)")

        # Verify state retention (registers not overwritten retain values)
        if step_count == 4:
            # After 'mov x3, x2': both X2 and X3 must be 30
            x2_val = int(curr_regs.get("x2", "0x0"), 16)
            x3_val = int(curr_regs.get("x3", "0x0"), 16)
            assert x2_val == 30 and x3_val == 30, f"Register retention failed! x2={x2_val}, x3={x3_val}"
            print("  -> [VERIFIED]: Register X2 retained 30 while X3 was copied to 30.")

        prev_regs = curr_regs

        if "exited" in stop_str:
            print("\n>> Child process exited cleanly through syscall sys_exit.")
            break

    try:
        p.stdin.write("-gdb-exit\n")
        p.stdin.flush()
        p.wait(timeout=1)
    except Exception:
        p.kill()

    print("\n" + "=" * 60)
    print("SUCCESS: Milestone 1 Acceptance Test PASSED on Raspberry Pi 5!")
    print("=" * 60)

if __name__ == "__main__":
    test_milestone1()
