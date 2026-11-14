// 01_arithmetic.s - Native AArch64 Arithmetic Demonstration
// Demonstrates: MOV, ADD, SUB, MUL, register state retention, and clean Linux exit syscall.

.global _start
.text

_start:
    // Step 1: Load 10 into X0
    mov     x0, #10

    // Step 2: Load 20 into X1
    mov     x1, #20

    // Step 3: Add X0 and X1, store result (30) in X2
    add     x2, x0, x1

    // Step 4: Copy X2 into X3. Notice X2 retains 30, and X3 becomes 30.
    mov     x3, x2

    // Step 5: Subtract X0 (10) from X2 (30), store result (20) in X4
    sub     x4, x2, x0

    // Step 6: Multiply X0 (10) and X1 (20), store result (200) in X5
    mul     x5, x0, x1

    // Step 7: Compare X2 and X3 (both are 30), setting PSTATE condition flags (Z=1, C=1)
    cmp     x2, x3

    // Clean exit using Linux AArch64 syscall (syscall 93 is sys_exit)
    mov     x8, #93
    mov     x0, #0
    svc     #0
