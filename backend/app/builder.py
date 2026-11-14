import subprocess
import os
from pathlib import Path
from typing import Tuple, Optional
from app.config import WORKSPACE_DIR
from app.schemas import BuildResponse

class AssemblyBuilder:
    def __init__(self, workspace_dir: Path = WORKSPACE_DIR):
        self.workspace_dir = workspace_dir
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.helper_c = Path(__file__).resolve().parent / "hardware" / "gpio_helper.c"

    def build_standalone(self, assembly_code: str, project_id: str = "current") -> BuildResponse:
        """
        Compiles AArch64 assembly.
        Uses GNU 'as -g'.
        If 'main' entry point or C helper calls are detected (e.g. led_set, usleep),
        links with GCC and gpio_helper.c. Otherwise links with GNU 'ld'.
        """
        proj_dir = self.workspace_dir / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)

        asm_file = proj_dir / "program.s"
        obj_file = proj_dir / "program.o"
        elf_file = proj_dir / "program.elf"

        # Write assembly source
        asm_file.write_text(assembly_code, encoding="utf-8")

        # 1. Assemble with GNU 'as -g'
        as_cmd = ["as", "-g", "-o", str(obj_file), str(asm_file)]
        try:
            res_as = subprocess.run(as_cmd, capture_output=True, text=True, timeout=10)
            if res_as.returncode != 0:
                err_msg = res_as.stderr.strip()
                # Friendly architectural hint for common ARM64 immediate error
                if "immediate cannot be moved by a single instruction" in err_msg:
                    err_msg += (
                        "\n\n[System Architecture Tip - ARM64 32-bit Instruction Encoding]:\n"
                        "In ARM64 (AArch64), each machine instruction is strictly 32 bits wide.\n"
                        "The 'mov' instruction can only load 16-bit immediates (0 to 65535 / 0xFFFF).\n"
                        "To load larger values like 1000000 (0xF4240):\n"
                        "  * Recommended: Use the load pseudo-instruction:\n"
                        "      ldr x0, =1000000\n"
                        "  * Or use two instructions with 'movz' and 'movk':\n"
                        "      movz x0, #0x4240\n"
                        "      movk x0, #0x000f, lsl #16"
                    )
                return BuildResponse(
                    success=False,
                    errors=f"Assembler Error:\n{err_msg}"
                )
        except Exception as e:
            return BuildResponse(success=False, errors=f"Failed to run 'as': {str(e)}")

        # 2. Determine Linker: GCC if 'main' or external C functions are used, else 'ld'
        uses_main = ("main:" in assembly_code or ".global main" in assembly_code)
        uses_c_helpers = any(fn in assembly_code for fn in ["led_set", "usleep", "delay_ms", "printf", "puts"])

        if uses_main or uses_c_helpers:
            # Link with GCC, libc, and gpio_helper if present
            gcc_cmd = ["gcc", "-g", "-no-pie", "-o", str(elf_file), str(obj_file)]
            if self.helper_c.exists():
                gcc_cmd.append(str(self.helper_c))
            try:
                res_link = subprocess.run(gcc_cmd, capture_output=True, text=True, timeout=10)
                if res_link.returncode != 0:
                    return BuildResponse(
                        success=False,
                        errors=f"Linker Error (GCC):\n{res_link.stderr}\n{res_link.stdout}"
                    )
            except Exception as e:
                return BuildResponse(success=False, errors=f"Failed to run 'gcc': {str(e)}")
        else:
            # Standalone bare-metal / raw Linux syscall assembly linking with GNU 'ld'
            ld_cmd = ["ld", "-o", str(elf_file), str(obj_file)]
            try:
                res_ld = subprocess.run(ld_cmd, capture_output=True, text=True, timeout=10)
                if res_ld.returncode != 0:
                    # If ld failed because of undefined references, try fallback with GCC
                    if "undefined reference" in res_ld.stderr and self.helper_c.exists():
                        gcc_fallback = ["gcc", "-g", "-no-pie", "-o", str(elf_file), str(obj_file), str(self.helper_c)]
                        res_fb = subprocess.run(gcc_fallback, capture_output=True, text=True, timeout=10)
                        if res_fb.returncode == 0:
                            res_ld = res_fb
                    if res_ld.returncode != 0:
                        return BuildResponse(
                            success=False,
                            errors=f"Linker Error:\n{res_ld.stderr}\n{res_ld.stdout}"
                        )
            except Exception as e:
                return BuildResponse(success=False, errors=f"Failed to run 'ld': {str(e)}")

        # 3. Disassemble for inspection
        disassembly = ""
        try:
            objdump_cmd = ["objdump", "-d", "-M", "no-aliases", str(elf_file)]
            res_dump = subprocess.run(objdump_cmd, capture_output=True, text=True, timeout=10)
            if res_dump.returncode == 0:
                disassembly = res_dump.stdout
        except Exception:
            pass

        return BuildResponse(
            success=True,
            executable_path=str(elf_file),
            disassembly=disassembly
        )
