import subprocess
import threading
import queue
import time
import re
from typing import Dict, List, Optional, Tuple, Any
from app.schemas import RegisterSnapshot, RegisterDiff, StepEvent

class GDBEngine:
    def __init__(self, executable_path: str, timeout: float = 5.0):
        self.executable_path = executable_path
        self.timeout = timeout
        self.process: Optional[subprocess.Popen] = None
        self.reg_names: Dict[int, str] = {}
        self.is_running = False
        self.is_halted = False
        self.exit_code: Optional[int] = None
        self.current_step = 0
        self.last_snapshot: Optional[RegisterSnapshot] = None

    def start(self, entry_symbol: str = "_start") -> bool:
        """
        Starts the GDB process with GDB/MI interpreter, sets initial breakpoint, and runs to entry.
        """
        cmd = ["gdb", "--interpreter=mi3", "-q", self.executable_path]
        try:
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
        except Exception as e:
            raise RuntimeError(f"Failed to start GDB: {e}")

        # Initial handshake: wait for prompt (gdb)
        self._read_until_prompt()

        # Fetch register names
        self._load_register_names()

        # Set breakpoint at main (user routine) or _start (standalone)
        res = self._send_cmd("-break-insert main")
        if not any("^done" in l for l in res):
            res = self._send_cmd(f"-break-insert {entry_symbol}")

        # Run program: -exec-run sends ^running (gdb), then *stopped (gdb)
        self._send_cmd("-exec-run")
        self._read_until_prompt()

        self.is_running = True
        self.is_halted = False
        self.current_step = 0
        self.last_snapshot = self.get_register_snapshot()
        return True

    def continue_run(self) -> StepEvent:
        """
        Runs the process until it exits or stops (GDB -exec-continue).
        Used for 'Run to completion' after pausing at a breakpoint or step.
        """
        if not self.is_running or self.is_halted:
            raise RuntimeError("GDB session is not running or has already halted.")

        snapshot_before = self.last_snapshot or self.get_register_snapshot()
        pc_before = snapshot_before.pc

        self._send_cmd("-exec-continue")
        stop_lines = self._read_until_prompt()
        stop_str = "\n".join(stop_lines)

        exited = "exited" in stop_str
        if exited:
            self.is_halted = True
            self.is_running = False
            m = re.search(r'exit-code="([^"]+)"', stop_str)
            exit_code = int(m.group(1), 8) if m else 0
            self.exit_code = exit_code
        else:
            # Stopped by a signal/breakpoint; still capture fresh state
            exit_code = None
            self.last_snapshot = self.get_register_snapshot()

        return StepEvent(
            step_number=self.current_step,
            address=pc_before,
            instruction="(run to completion)",
            pc_before=pc_before,
            pc_after=self.last_snapshot.pc if not exited else "0x0",
            changed_registers=[],
            snapshot_before=snapshot_before,
            snapshot_after=self.last_snapshot if not exited else snapshot_before,
            is_halted=self.is_halted,
            exit_code=exit_code
        )

    def step_instruction(self) -> StepEvent:
        """
        Steps exactly one machine instruction (stepi), captures before/after register state,
        computes diffs, and returns a structured StepEvent.
        """
        if not self.is_running or self.is_halted:
            raise RuntimeError("GDB session is not running or has already halted.")

        # Capture state before instruction
        snapshot_before = self.last_snapshot or self.get_register_snapshot()
        pc_before = snapshot_before.pc

        # Get instruction text before advancing
        inst_text, addr_text = self._get_current_instruction()

        # Step one instruction: -exec-step-instruction emits ^running (gdb), then *stopped (gdb)
        self.current_step += 1
        self._send_cmd("-exec-step-instruction")
        stop_lines = self._read_until_prompt()
        stop_str = "\n".join(stop_lines)

        # Check if process exited
        if "exited" in stop_str:
            self.is_halted = True
            self.is_running = False
            m = re.search(r'exit-code="([^"]+)"', stop_str)
            exit_code = int(m.group(1), 8) if m else 0
            self.exit_code = exit_code

            return StepEvent(
                step_number=self.current_step,
                address=addr_text,
                instruction=inst_text or "Process exited",
                pc_before=pc_before,
                pc_after="0x0",
                changed_registers=[],
                snapshot_before=snapshot_before,
                snapshot_after=snapshot_before,
                is_halted=True,
                exit_code=exit_code
            )

        # Capture state after instruction
        snapshot_after = self.get_register_snapshot()
        self.last_snapshot = snapshot_after
        pc_after = snapshot_after.pc

        # Calculate diffs
        changed_registers = self._compute_diff(snapshot_before, snapshot_after)

        return StepEvent(
            step_number=self.current_step,
            address=addr_text,
            instruction=inst_text,
            pc_before=pc_before,
            pc_after=pc_after,
            changed_registers=changed_registers,
            snapshot_before=snapshot_before,
            snapshot_after=snapshot_after,
            is_halted=self.is_halted
        )

    def get_register_snapshot(self) -> RegisterSnapshot:
        """
        Queries all registers and PSTATE from GDB.
        """
        regs_hex = self._fetch_register_values("x")
        regs_dec = self._fetch_register_values("d")

        pc_val = regs_hex.get("pc", "0x0")
        sp_val = regs_hex.get("sp", "0x0")
        flags = self._parse_flags(regs_hex.get("cpsr", regs_hex.get("pstate", "0x0")))

        return RegisterSnapshot(
            registers=regs_hex,
            decimal_values=regs_dec,
            pc=pc_val,
            sp=sp_val,
            flags=flags
        )

    def stop(self):
        """
        Safely terminates GDB and child process.
        """
        if self.process:
            try:
                self.process.stdin.write("-gdb-exit\n")
                self.process.stdin.flush()
                self.process.wait(timeout=1.0)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
        self.is_running = False
        self.is_halted = True

    def _read_until_prompt(self) -> List[str]:
        lines = []
        if not self.process:
            return lines
        while True:
            line = self.process.stdout.readline()
            if not line:
                break
            l = line.strip()
            lines.append(l)
            if l == "(gdb)":
                break
        return lines

    def _send_cmd(self, cmd: str) -> List[str]:
        if not self.process or self.process.poll() is not None:
            return []
        self.process.stdin.write(cmd + "\n")
        self.process.stdin.flush()
        return self._read_until_prompt()

    def _load_register_names(self):
        out_lines = self._send_cmd("-data-list-register-names")
        for line in out_lines:
            match = re.search(r'register-names=\[(.*?)\]', line)
            if match:
                names = re.findall(r'"(.*?)"', match.group(1))
                self.reg_names = {idx: name.lower() for idx, name in enumerate(names) if name}

    def _fetch_register_values(self, fmt: str) -> Dict[str, Any]:
        out_lines = self._send_cmd(f"-data-list-register-values {fmt}")
        vals = {}
        for line in out_lines:
            for m in re.finditer(r'\{number="(\d+)",value="([^"]+)"\}', line):
                idx = int(m.group(1))
                val = m.group(2)
                name = self.reg_names.get(idx)
                if name:
                    name_clean = name.lower()
                    if fmt == "d":
                        try:
                            vals[name_clean] = int(val)
                        except ValueError:
                            vals[name_clean] = 0
                    else:
                        vals[name_clean] = val
        return vals

    def _get_current_instruction(self) -> Tuple[str, str]:
        """
        Uses GDB console CLI command 'x/i $pc' to inspect exact assembly text.
        """
        out_lines = self._send_cmd('-interpreter-exec console "x/i $pc"')
        for line in out_lines:
            m = re.search(r'=>\s*(0x[0-9a-fA-F]+)\s*(?:<[^>]+>)?:?\s*(.*)', line)
            if m:
                raw = m.group(2)
                clean = raw.replace('\\t', ' ').replace('\\n', '').replace('"', '').strip()
                return clean, m.group(1)
        return "", ""

    def _parse_flags(self, pstate_hex: str) -> Dict[str, bool]:
        try:
            val = int(pstate_hex, 16)
            return {
                "N": bool(val & (1 << 31)),
                "Z": bool(val & (1 << 30)),
                "C": bool(val & (1 << 29)),
                "V": bool(val & (1 << 28))
            }
        except Exception:
            return {"N": False, "Z": False, "C": False, "V": False}

    def _compute_diff(self, before: RegisterSnapshot, after: RegisterSnapshot) -> List[RegisterDiff]:
        diffs = []
        tracked_keys = [f"x{i}" for i in range(31)] + ["sp", "pc", "cpsr", "pstate"]

        for k in tracked_keys:
            old_hex = before.registers.get(k, "0x0")
            new_hex = after.registers.get(k, "0x0")
            if old_hex != new_hex:
                old_dec = before.decimal_values.get(k, 0)
                new_dec = after.decimal_values.get(k, 0)
                diffs.append(RegisterDiff(
                    reg=k.upper(),
                    old_value=old_hex,
                    new_value=new_hex,
                    old_decimal=old_dec,
                    new_decimal=new_dec
                ))
        return diffs
