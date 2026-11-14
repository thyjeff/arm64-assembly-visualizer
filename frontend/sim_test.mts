import { AArch64Simulator } from './src/simulator/aarch64';

// Test 2: file creation preset (matches App.tsx SAMPLE_FILE_CREATION)
const file = `.global _start

.data
filename:
    .asciz  "output_demo.txt"

message:
    .ascii  "Hello from Raspberry Pi 5 native AArch64 assembly!\\nCreated via Linux Syscalls.\\n"
msg_end:
    .equ    msg_len, msg_end - message

.text
_start:
    mov     x0, #-100
    ldr     x1, =filename
    mov     x2, #0x241
    mov x3, #0x1a4
    mov     x8, #56
    svc     #0
    mov     x19, x0
    mov     x0, x19
    ldr     x1, =message
    mov     x2, #msg_len
    mov     x8, #64
    svc     #0
    mov     x0, x19
    mov     x8, #57
    svc     #0
    mov     x0, #0
    mov     x8, #93
    svc     #0
`;

let s = new AArch64Simulator();
let err = s.load(file);
console.log('T2 load err:', err);
const evs2 = s.run();
const last2 = evs2[evs2.length - 1];
console.log('T2 halted:', last2.is_halted, 'exit:', last2.exit_code);
const openEv = evs2.find(e => e.changed_registers.some(c => c.reg === 'X0' && c.new_decimal === 3 && e.instruction.startsWith('svc')));
console.log('T2 openat returned fd=3:', !!openEv);
const wrEv = evs2.find(e => e.changed_registers.some(c => c.reg === 'X0' && c.new_decimal > 0 && e.instruction.startsWith('svc') && e.step_number > 2));
console.log('T2 write returned byte count:', wrEv ? wrEv.changed_registers.find(c => c.reg === 'X0')!.new_decimal : 'MISSING');
console.log('T2 total steps:', evs2.length);

// Test 3: LCD hello preset (matches App.tsx SAMPLE_LCD)
const lcd = `.global main
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
`;

s = new AArch64Simulator();
err = s.load(lcd);
console.log('T3 load err:', err);
const evs3 = s.run();
const l3 = evs3[evs3.length - 1];
console.log('T3 steps:', evs3.length, 'halted:', l3.is_halted, 'exit:', l3.exit_code);
console.log('T3 x0 after ldr =greeting (data addr):', evs3[2].snapshot_after.registers.x0);

// Test 4: GPIO preset with bl to unknown helper + loop-free
const gpio = `.global main
.type main, %function
main:
    stp     x29, x30, [sp, #-16]!
    mov     x29, sp
    mov     x0, #1
    bl      led_set
    ldr     x0, =1000000
    bl      usleep
    mov     x0, #0
    bl      led_set
    ldr     x0, =1000000
    bl      usleep
    mov     x0, #0
    ldp     x29, x30, [sp], #16
    ret
`;
s = new AArch64Simulator();
err = s.load(gpio);
console.log('T4 load err:', err);
const evs4 = s.run();
console.log('T4 halted:', evs4[evs4.length - 1].is_halted, 'exit:', evs4[evs4.length - 1].exit_code, 'steps:', evs4.length);

// Test 5: branch loop (countdown)
const loop = `.global _start
.text
_start:
    mov x19, #3
loop:
    subs x19, x19, #1
    b.ne loop
    mov x0, #0
    mov x8, #93
    svc #0
`;
s = new AArch64Simulator();
err = s.load(loop);
console.log('T5 load err:', err);
const evs5 = s.run();
console.log('T5 halted:', evs5[evs5.length - 1].is_halted, 'exit:', evs5[evs5.length - 1].exit_code, 'steps:', evs5.length, '(expect > 5 due to loop)');
console.log('T5 x19 final:', evs5[evs5.length - 1].snapshot_after.registers.x19);
