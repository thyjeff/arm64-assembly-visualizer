// 04_create_file.s - Native AArch64 Linux Syscalls for Text File Creation
// Demonstrates creating and writing to a real file on the Raspberry Pi:
//   - Syscall 56: openat(AT_FDCWD, filename, O_CREAT|O_WRONLY|O_TRUNC, 0644)
//   - Syscall 64: write(fd, message, length)
//   - Syscall 57: close(fd)
//   - Syscall 93: exit(0)

.global _start

.data
filename:
    .asciz  "output_demo.txt"

message:
    .ascii  "Hello from Raspberry Pi 5 native AArch64 assembly!\nArchitecture demonstrator created this file successfully.\n"
msg_end:
    .equ    msg_len, msg_end - message

.text
_start:
    // -------------------------------------------------------------
    // 1. OPEN / CREATE FILE: sys_openat (Syscall 56)
    // int openat(int dfd, const char *filename, int flags, umode_t mode)
    // -------------------------------------------------------------
    mov     x0, #-100           // AT_FDCWD (-100): open relative to current working directory
    ldr     x1, =filename       // Pointer to "output_demo.txt"
    mov     x2, #0x241          // O_WRONLY | O_CREAT | O_TRUNC (1 | 64 | 512 = 577)
    mov     x3, #0x1a4          // File permissions: 0644 (rw-r--r--)
    mov     x8, #56             // Linux AArch64 syscall number for openat
    svc     #0                  // Kernel returns file descriptor (fd) in X0

    // Save returned file descriptor into X19 (callee-saved)
    mov     x19, x0

    // -------------------------------------------------------------
    // 2. WRITE TO FILE: sys_write (Syscall 64)
    // ssize_t write(int fd, const void *buf, size_t count)
    // -------------------------------------------------------------
    mov     x0, x19             // FD in X0
    ldr     x1, =message        // Buffer pointer in X1
    mov     x2, #msg_len        // Number of bytes in X2
    mov     x8, #64             // Linux AArch64 syscall number for write
    svc     #0                  // Kernel returns bytes written in X0

    // -------------------------------------------------------------
    // 3. CLOSE FILE: sys_close (Syscall 57)
    // int close(int fd)
    // -------------------------------------------------------------
    mov     x0, x19             // FD in X0
    mov     x8, #57             // Linux AArch64 syscall number for close
    svc     #0                  // Kernel closes file

    // -------------------------------------------------------------
    // 4. CLEAN EXIT: sys_exit (Syscall 93)
    // -------------------------------------------------------------
    mov     x0, #0              // Exit code 0
    mov     x8, #93             // sys_exit
    svc     #0
