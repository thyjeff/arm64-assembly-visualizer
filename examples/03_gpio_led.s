// 03_gpio_led.s - AArch64 Assembly calling C GPIO helper according to AAPCS64

.global run_assembly_demo
.text

run_assembly_demo:
    // Standard AArch64 function prologue: save FP (x29) and LR (x30)
    stp     x29, x30, [sp, #-16]!
    mov     x29, sp

    // 1. Perform arithmetic
    mov     x0, #10
    mov     x1, #20
    add     x2, x0, x1
    mov     x3, x2

    // 2. Turn LED ON: call led_set(1)
    mov     x0, #1              // First argument in X0
    bl      led_set

    // 3. Delay: call delay_ms(500)
    mov     x0, #500
    bl      delay_ms

    // 4. Turn LED OFF: call led_set(0)
    mov     x0, #0              // First argument in X0
    bl      led_set

    // Standard AArch64 function epilogue: restore FP and LR, then return
    ldp     x29, x30, [sp], #16
    ret
