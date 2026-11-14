import subprocess
import os
import re

elf_file = os.path.expanduser("~/arm64_visualizer/build_test/01_arithmetic.elf")
gdb_cmd = ["gdb", "--interpreter=mi3", "-q", elf_file]
p = subprocess.Popen(gdb_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)

def send_gdb(cmd_str):
    p.stdin.write(cmd_str + "\n")
    p.stdin.flush()
    lines = []
    while True:
        line = p.stdout.readline()
        if not line:
            break
        line_str = line.strip()
        lines.append(line_str)
        if line_str == "(gdb)":
            break
    return lines

# Handshake
while True:
    line = p.stdout.readline()
    if not line or line.strip() == "(gdb)":
        break

print("Break insert:", send_gdb("-break-insert _start"))
print("Exec run:", send_gdb("-exec-run"))
print("Console x/i $pc:", send_gdb('-interpreter-exec console "x/i $pc"'))
print("Data disassemble:", send_gdb('-data-disassemble -s $pc -e "$pc + 4" -- 0'))

p.kill()
