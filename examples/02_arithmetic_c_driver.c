// 02_arithmetic_c_driver.c - C host driver and safe GPIO helper for AArch64 demo
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// Forward declaration of assembly entry point
extern void run_assembly_demo(void);

// Fixed GPIO helper callable from Assembly according to AAPCS64
// State: 1 = ON, 0 = OFF
void led_set(int state) {
    if (state) {
        printf("[GPIO HELPER] LED -> ON (State = %d)\n", state);
        // Calls to libgpiod will be integrated here
    } else {
        printf("[GPIO HELPER] LED -> OFF (State = %d)\n", state);
    }
    fflush(stdout);
}

// Optional delay helper callable from Assembly
void delay_ms(int ms) {
    printf("[DELAY HELPER] Sleeping for %d ms...\n", ms);
    usleep(ms * 1000);
}

int main(void) {
    printf("=== Starting ARM64 Architecture Visualizer Demo ===\n");
    // Initially ensure LED is OFF
    led_set(0);

    // Call native AArch64 assembly routine
    run_assembly_demo();

    // Ensure LED clean shutdown on normal termination
    led_set(0);
    printf("=== Demo Completed Successfully ===\n");
    return 0;
}
