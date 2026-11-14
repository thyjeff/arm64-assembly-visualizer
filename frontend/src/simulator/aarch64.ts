// aarch64.ts - Browser-side AArch64 mini-simulator for Demo Mode.
//
// When the Raspberry Pi is unreachable, the portal runs the exact same
// user interface against this simulator instead of the GDB backend.
// It supports the instruction subset taught in this project:
//   mov / ldr =literal / add / sub / mul / cmp / svc / b / b.cond
//   stp/ldp x29,x30 pairs (frame pointer save/restore) / ret / bl
//
// It produces StepEvent objects with the same shape as the backend's
// GDB-derived events, so the whole UI works unchanged.

import { RegisterDiff, RegisterSnapshot, StepEvent } from '../types/debugger';

const TEXT_BASE = 0x400078n; // mirrors the real linker layout
const DATA_BASE = 0x420000n;

interface DataItem {
  label: string;
  offset: number; // byte offset within .data
  bytes: number[]; // content (for size/length computation)
}

interface TextInstruction {
  mnemonic: string;
  operands: string; // raw operand text
  address: string;
}

interface ParsedProgram {
  instructions: TextInstruction[];
  labels: Map<string, number>; // label -> instruction index
  dataItems: DataItem[];
  dataLabels: Map<string, number>; // label -> byte offset in .data
  constants: Map<string, bigint>; // .equ constants
  parseErrors: string[];
}

function cleanLine(raw: string): string {
  let line = raw;
  const cIdx = line.indexOf('//');
  if (cIdx >= 0) line = line.slice(0, cIdx);
  const sIdx = line.indexOf(';');
  if (sIdx >= 0) line = line.slice(0, sIdx);
  return line.trim();
}

function parseAssembly(code: string): ParsedProgram {
  const instructions: TextInstruction[] = [];
  const labels = new Map<string, number>();
  const dataItems: DataItem[] = [];
  const dataLabels = new Map<string, number>();
  const constants = new Map<string, bigint>();
  const parseErrors: string[] = [];

  let section: 'none' | 'data' | 'text' = 'none';
  let dataOffset = 0;

  for (const raw of code.split('\n')) {
    const line = cleanLine(raw);
    if (!line) continue;

    // Section switches
    if (line === '.data' || line.startsWith('.data ')) { section = 'data'; continue; }
    if (line === '.text' || line.startsWith('.text ')) { section = 'text'; continue; }

    // Directives we can ignore outright
    if (/^\.(global|type|size|align|section|extern|hidden)/.test(line)) continue;

    // .equ NAME, expr
    const equMatch = line.match(/^\.equ\s+(\w+)\s*,\s*(.+)$/);
    if (equMatch) {
      const expr = equMatch[2].replace(/\s+/g, '');
      const diff = expr.match(/^(\w+)-(\w+)$/);
      if (diff) {
        const a = dataLabels.get(diff[1]);
        const b = dataLabels.get(diff[2]);
        if (a !== undefined && b !== undefined) {
          constants.set(equMatch[1], BigInt(a - b));
        } else {
          parseErrors.push(`.equ ${equMatch[1]}: unknown labels ${expr}`);
        }
      } else if (/^-?\d+$/.test(expr)) {
        constants.set(equMatch[1], BigInt(expr));
      } else {
        parseErrors.push(`.equ ${equMatch[1]}: unsupported expression ${expr}`);
      }
      continue;
    }

    // Label definition (e.g. "main:" or "filename:")
    const labelMatch = line.match(/^(\w+)\s*:\s*(.*)$/);
    let rest = line;
    if (labelMatch) {
      const label = labelMatch[1];
      rest = labelMatch[2].trim();
      if (section === 'text') labels.set(label, instructions.length);
      else if (section === 'data') dataLabels.set(label, dataOffset);
    }
    if (!rest) continue;

    // Data directives
    if (section === 'data') {
      const asciz = rest.match(/^\.asciz\s+"(.*)"\s*$/);
      const ascii = rest.match(/^\.ascii\s+"(.*)"\s*$/);
      if (asciz || ascii) {
        const text = (asciz ? asciz[1] : ascii![1])
          .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\0/g, '\0');
        const bytes = Array.from(text).flatMap(ch => {
          const arr: number[] = [];
          // UTF-8 encode non-ASCII characters like the real assembler would
          const encoded = new TextEncoder().encode(ch);
          arr.push(...encoded);
          return arr;
        });
        if (asciz) bytes.push(0);
        dataItems.push({ label: labelMatch ? labelMatch[1] : '', offset: dataOffset, bytes });
        dataOffset += bytes.length;
        continue;
      }
      const byte = rest.match(/^\.byte\s+(.+)$/);
      if (byte) {
        const values = byte[1].split(',').map(v => parseInt(v.trim(), 0) & 0xff);
        dataItems.push({ label: labelMatch ? labelMatch[1] : '', offset: dataOffset, bytes: values });
        dataOffset += values.length;
        continue;
      }
      parseErrors.push(`Unsupported data directive: ${rest}`);
      continue;
    }

    // Text instruction
    const spaceIdx = rest.indexOf(' ');
    const mnemonic = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
    const operands = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
    instructions.push({
      mnemonic,
      operands,
      address: '0x' + (TEXT_BASE + BigInt(instructions.length) * 4n).toString(16),
    });
  }

  return { instructions, labels, dataItems, dataLabels, constants, parseErrors };
}

// ---------- 64-bit helpers ----------
function toHex64(v: bigint): string {
  return '0x' + BigInt.asUintN(64, v).toString(16);
}
function toDec64(v: bigint): number {
  return Number(BigInt.asIntN(64, v));
}
function u64(v: bigint | number): bigint {
  return BigInt.asUintN(64, typeof v === 'bigint' ? v : BigInt(Math.trunc(v)));
}

const GP_REGS = Array.from({ length: 31 }, (_, i) => `x${i}`);

class SimCPU {
  regs = new Map<string, bigint>();
  sp = 0x7ffffffff000n;
  flags = { N: false, Z: false, C: false, V: false };
  pcIndex = 0;
  halted = false;
  exitCode: number | null = null;
  stack = new Map<bigint, [bigint, bigint]>(); // sp -> saved [x29, x30]
  linkRegister: bigint | null = null;

  constructor() {
    for (const r of GP_REGS) this.regs.set(r, 0n);
    this.regs.set('xzr', 0n);
    this.regs.set('x29', 0n);
    this.regs.set('x30', 0n);
  }

  get(reg: string): bigint {
    const r = reg.toLowerCase();
    if (r === 'xzr') return 0n;
    if (r === 'sp') return this.sp;
    return this.regs.get(r) ?? 0n;
  }

  set(reg: string, value: bigint): void {
    const r = reg.toLowerCase();
    if (r === 'xzr') return; // writes to xzr are discarded
    if (r === 'sp') { this.sp = value; return; }
    this.regs.set(r, value);
  }

  snapshot(): RegisterSnapshot {
    const registers: Record<string, string> = {};
    const decimal: Record<string, number> = {};
    for (const r of GP_REGS) {
      const v = this.regs.get(r) ?? 0n;
      registers[r] = toHex64(v);
      decimal[r] = toDec64(v);
    }
    registers['sp'] = toHex64(this.sp);
    decimal['sp'] = toDec64(this.sp);
    return {
      registers,
      decimal_values: decimal,
      pc: this.halted ? '0x0' : toHex64(TEXT_BASE + BigInt(this.pcIndex) * 4n),
      sp: toHex64(this.sp),
      flags: { ...this.flags },
    };
  }
}

export class AArch64Simulator {
  private program: ParsedProgram | null = null;
  private cpu = new SimCPU();
  private stepCount = 0;

  /** Parse and validate. Returns an error string on failure, null on success. */
  load(code: string): string | null {
    const program = parseAssembly(code);
    if (program.parseErrors.length > 0) {
      return 'Simulator parse errors:\n' + program.parseErrors.join('\n');
    }
    if (program.instructions.length === 0) {
      return 'Simulator: no instructions found in .text section.';
    }
    this.program = program;
    this.cpu = new SimCPU();
    this.stepCount = 0;
    return null;
  }

  reset(): void {
    if (this.program) this.cpu = new SimCPU();
    this.stepCount = 0;
  }

  snapshot(): RegisterSnapshot {
    return this.cpu.snapshot();
  }

  private resolveImmediate(token: string): bigint | null {
    const t = token.trim().replace(/^#/, '');
    if (/^-?\d+$/.test(t)) return u64(BigInt(t));
    if (/^0x[0-9a-fA-F]+$/.test(t)) return u64(BigInt(t));
    const c = this.program?.constants.get(t);
    if (c !== undefined) return u64(c);
    // label used as immediate (e.g. =message) resolves to its data address
    const off = this.program?.dataLabels.get(t);
    if (off !== undefined) return u64(DATA_BASE + BigInt(off));
    return null;
  }

  private diff(before: RegisterSnapshot, after: RegisterSnapshot): RegisterDiff[] {
    const diffs: RegisterDiff[] = [];
    for (const key of [...GP_REGS, 'sp']) {
      const oldHex = before.registers[key] ?? '0x0';
      const newHex = after.registers[key] ?? '0x0';
      if (oldHex !== newHex) {
        diffs.push({
          reg: key.toUpperCase(),
          old_value: oldHex,
          new_value: newHex,
          old_decimal: before.decimal_values[key] ?? 0,
          new_decimal: after.decimal_values[key] ?? 0,
        });
      }
    }
    if (before.pc !== after.pc) {
      diffs.push({
        reg: 'PC',
        old_value: before.pc,
        new_value: after.pc,
        old_decimal: parseInt(before.pc, 16),
        new_decimal: parseInt(after.pc, 16),
      });
    }
    return diffs;
  }

  /** Execute one instruction. Returns a StepEvent identical in shape to backend events. */
  step(): StepEvent {
    if (!this.program) throw new Error('Simulator: no program loaded.');
    const cpu = this.cpu;
    const prog = this.program;

    if (cpu.halted) {
      throw new Error('Simulator: program has already halted.');
    }
    if (cpu.pcIndex >= prog.instructions.length) {
      cpu.halted = true;
      cpu.exitCode = 0;
    }

    const inst = prog.instructions[cpu.pcIndex];
    const before = cpu.snapshot();
    const pcBefore = inst.address;

    const ops = inst.operands.split(',').map(o => o.trim()).filter(Boolean);

    switch (inst.mnemonic) {
      case 'mov':
      case 'movz':
      case 'movn': {
        const dst = ops[0];
        const src = ops[1];
        if (src.startsWith('#') || /^-?\d+$/.test(src) || /^0x/.test(src)) {
          const v = this.resolveImmediate(src);
          if (v === null) throw new Error(`Simulator: bad immediate '${src}'`);
          cpu.set(dst, v);
        } else {
          cpu.set(dst, cpu.get(src));
        }
        cpu.pcIndex++;
        break;
      }
      case 'ldr': {
        const dst = ops[0];
        const src = ops[1]?.trim() ?? '';
        if (src.startsWith('=')) {
          const v = this.resolveImmediate(src.slice(1));
          if (v === null) throw new Error(`Simulator: unknown literal '${src}'`);
          cpu.set(dst, v);
        } else if (/^#-?\d+$/.test(src)) {
          cpu.set(dst, this.resolveImmediate(src)!);
        } else {
          // ldr xN, [xM] style is not modelled; treat as zero load
          cpu.set(dst, 0n);
        }
        cpu.pcIndex++;
        break;
      }
      case 'add':
      case 'sub': {
        const dst = ops[0];
        const a = this.resolveOperandValue(ops[1]);
        const b = this.resolveOperandValue(ops[2]);
        const result = inst.mnemonic === 'add' ? (a + b) : (a - b);
        cpu.set(dst, u64(result));
        cpu.pcIndex++;
        break;
      }
      case 'adds':
      case 'subs': {
        // Flag-setting variants (adds/subs/subs-as-cmp-with-destination)
        const dst = ops[0];
        const a = this.resolveOperandValue(ops[1]);
        const b = this.resolveOperandValue(ops[2]);
        const isAdd = inst.mnemonic === 'adds';
        const result = isAdd ? (a + b) : (a - b);
        const sa = BigInt.asIntN(64, a);
        const sb = BigInt.asIntN(64, b);
        const signedResult = isAdd ? (sa + sb) : (sa - sb);
        cpu.flags.N = ((u64(result) >> 63n) & 1n) === 1n;
        cpu.flags.Z = u64(result) === 0n;
        cpu.flags.C = isAdd
          ? (result > 0xffff_ffff_ffff_ffffn || result < 0n)  // unsigned carry
          : (a >= b);                                          // no borrow
        cpu.flags.V =
          signedResult > 0x7fff_ffff_ffff_ffffn ||
          signedResult < -0x8000_0000_0000_0000n;              // signed overflow
        cpu.set(dst, u64(result));
        cpu.pcIndex++;
        break;
      }
      case 'mul': {
        const dst = ops[0];
        const a = this.resolveOperandValue(ops[1]);
        const b = this.resolveOperandValue(ops[2]);
        cpu.set(dst, u64(a * b));
        cpu.pcIndex++;
        break;
      }
      case 'cmp': {
        const a = this.resolveOperandValue(ops[0]);
        const b = this.resolveOperandValue(ops[1]);
        const sa = BigInt.asIntN(64, a);
        const sb = BigInt.asIntN(64, b);
        const res = a - b;
        cpu.flags.N = ((res >> 63n) & 1n) === 1n;
        cpu.flags.Z = res === 0n;
        cpu.flags.C = a >= b; // no borrow
        cpu.flags.V = (sa - sb) !== BigInt.asIntN(64, res);
        cpu.pcIndex++;
        break;
      }
      case 'stp': {
        // stp x29, x30, [sp, #-16]!
        cpu.sp -= 16n;
        cpu.stack.set(cpu.sp, [cpu.get(ops[0]), cpu.get(ops[1])]);
        cpu.pcIndex++;
        break;
      }
      case 'ldp': {
        // ldp x29, x30, [sp], #16
        const saved = cpu.stack.get(cpu.sp);
        if (saved) {
          cpu.set(ops[0], saved[0]);
          cpu.set(ops[1], saved[1]);
        }
        cpu.sp += 16n;
        cpu.pcIndex++;
        break;
      }
      case 'bl': {
        const target = inst.operands.trim();
        const idx = prog.labels.get(target);
        if (idx !== undefined) {
          cpu.set('x30', u64(TEXT_BASE + BigInt(cpu.pcIndex + 1) * 4n));
          cpu.pcIndex = idx;
        } else {
          // Call into an unmodelled C helper (lcd_print, led_set, usleep...):
          // in demo mode these are documented as instant no-ops.
          cpu.pcIndex++;
        }
        break;
      }
      case 'ret': {
        const lr = cpu.get('x30');
        if (lr === 0n) {
          cpu.halted = true;
          cpu.exitCode = 0;
        } else {
          const idx = Number((lr - TEXT_BASE) / 4n);
          cpu.pcIndex = idx;
        }
        break;
      }
      case 'b': {
        const idx = prog.labels.get(inst.operands.trim());
        if (idx !== undefined) cpu.pcIndex = idx;
        else { cpu.halted = true; cpu.exitCode = 0; }
        break;
      }
      case 'beq': case 'b.eq':
      case 'bne': case 'b.ne':
      case 'blt': case 'b.lt':
      case 'bgt': case 'b.gt':
      case 'ble': case 'b.le':
      case 'bge': case 'b.ge': {
        const cond = inst.mnemonic.replace('b.', '').replace('b', '');
        let taken = false;
        if (cond === 'eq') taken = cpu.flags.Z;
        else if (cond === 'ne') taken = !cpu.flags.Z;
        else if (cond === 'lt') taken = cpu.flags.N !== cpu.flags.V;
        else if (cond === 'gt') taken = !cpu.flags.Z && cpu.flags.N === cpu.flags.V;
        else if (cond === 'le') taken = cpu.flags.Z || cpu.flags.N !== cpu.flags.V;
        else if (cond === 'ge') taken = cpu.flags.N === cpu.flags.V;
        const idx = prog.labels.get(inst.operands.trim());
        if (taken && idx !== undefined) cpu.pcIndex = idx;
        else cpu.pcIndex++;
        break;
      }
      case 'svc': {
        const syscall = Number(BigInt.asIntN(64, cpu.get('x8')));
        if (syscall === 93) {
          // sys_exit
          cpu.halted = true;
          cpu.exitCode = Number(BigInt.asIntN(64, cpu.get('x0')));
        } else if (syscall === 56) {
          // sys_openat -> return a fresh file descriptor (3)
          cpu.set('x0', 3n);
          cpu.pcIndex++;
        } else if (syscall === 64) {
          // sys_write -> return byte count (x2)
          cpu.set('x0', cpu.get('x2'));
          cpu.pcIndex++;
        } else if (syscall === 57) {
          // sys_close -> success
          cpu.set('x0', 0n);
          cpu.pcIndex++;
        } else {
          // Unknown syscall: return 0 and continue
          cpu.set('x0', 0n);
          cpu.pcIndex++;
        }
        break;
      }
      default: {
        // Unmodelled instruction (brk, nop, hint...): treat as no-op
        if (inst.mnemonic === 'brk') {
          cpu.halted = true;
          cpu.exitCode = 0;
        } else {
          cpu.pcIndex++;
        }
        break;
      }
    }

    this.stepCount++;
    const after = cpu.snapshot();
    const halted = cpu.halted;

    return {
      step_number: this.stepCount,
      address: pcBefore,
      instruction: inst.mnemonic + (inst.operands ? ' ' + inst.operands : ''),
      pc_before: pcBefore,
      pc_after: halted ? '0x0' : after.pc,
      changed_registers: this.diff(before, after),
      snapshot_before: before,
      snapshot_after: after,
      is_halted: halted,
      exit_code: halted ? (cpu.exitCode ?? 0) : undefined,
    };
  }

  private resolveOperandValue(token: string): bigint {
    const t = token.trim();
    if (t.startsWith('#') || /^-?\d+$/.test(t) || /^0x/.test(t)) {
      const v = this.resolveImmediate(t);
      if (v === null) throw new Error(`Simulator: bad operand '${t}'`);
      return v;
    }
    return this.cpu.get(t);
  }

  /** Run until halt (bounded). Returns all step events. */
  run(maxSteps = 5000): StepEvent[] {
    const events: StepEvent[] = [];
    while (!this.cpu.halted && events.length < maxSteps) {
      events.push(this.step());
    }
    return events;
  }
}
