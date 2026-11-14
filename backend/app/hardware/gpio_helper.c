#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <linux/i2c-dev.h>

// Forward declaration
void lcd_init_i2c(void);

// -------------------------------------------------------------
// GPIO Helper for External LED (BCM 17 / RP1)
// -------------------------------------------------------------
void led_set(int state) {
    if (state) {
        printf("[HARDWARE] LED -> ON (State 1)\n");
        system("pinctrl set 17 op dh 2>/dev/null || gpioset /dev/gpiochip0 17=1 2>/dev/null || true");
    } else {
        printf("[HARDWARE] LED -> OFF (State 0)\n");
        system("pinctrl set 17 op dl 2>/dev/null || gpioset /dev/gpiochip0 17=0 2>/dev/null || true");
    }
    fflush(stdout);
}

void delay_ms(int ms) {
    usleep(ms * 1000);
}

// -------------------------------------------------------------
// UDP bridge to the Pi backend (127.0.0.1:9001).
// The backend listens and forwards messages to the Arduino LCD
// over USB serial. This avoids opening /dev/ttyACM0 directly
// from the debugged process, which would assert DTR and reset
// the Arduino mid-session.
// -------------------------------------------------------------
void udp_send_pi_status(const char *line) {
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) return;

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(9001);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    sendto(s, line, strlen(line), 0, (struct sockaddr *)&addr, sizeof(addr));
    close(s);
}

// -------------------------------------------------------------
// Direct 16x2 I2C LCD Driver for Raspberry Pi 5 (/dev/i2c-1)
// Standard PCF8574 I2C Backpack: default address 0x27 or 0x3F
// -------------------------------------------------------------
#define LCD_BACKLIGHT 0x08
#define LCD_ENABLE    0x04
#define LCD_RS_DATA   0x01
#define LCD_RS_CMD    0x00

static int i2c_fd = -1;
static int lcd_addr = 0x27; // Checked against 0x27 and 0x3F

static void i2c_write_byte(unsigned char val) {
    if (i2c_fd >= 0) {
        write(i2c_fd, &val, 1);
    }
}

static void lcd_pulse(unsigned char data) {
    i2c_write_byte(data | LCD_ENABLE | LCD_BACKLIGHT);
    usleep(1);
    i2c_write_byte((data & ~LCD_ENABLE) | LCD_BACKLIGHT);
    usleep(50);
}

static void lcd_send_nibble(unsigned char nibble, unsigned char mode) {
    unsigned char val = (nibble & 0xF0) | mode | LCD_BACKLIGHT;
    i2c_write_byte(val);
    lcd_pulse(val);
}

static void lcd_send_byte(unsigned char byte, unsigned char mode) {
    lcd_send_nibble(byte & 0xF0, mode);
    lcd_send_nibble((byte << 4) & 0xF0, mode);
}

void lcd_init_i2c(void) {
    if (i2c_fd >= 0) return;

    i2c_fd = open("/dev/i2c-1", O_RDWR);
    if (i2c_fd < 0) {
        printf("[LCD] Note: /dev/i2c-1 not accessible or running in simulated mode.\n");
        return;
    }

    // Try address 0x27 first; if fails try 0x3F
    if (ioctl(i2c_fd, I2C_SLAVE, 0x27) < 0) {
        ioctl(i2c_fd, I2C_SLAVE, 0x3F);
        lcd_addr = 0x3F;
    } else {
        lcd_addr = 0x27;
    }

    // Standard 4-bit initialization sequence
    usleep(50000);
    lcd_send_nibble(0x30, LCD_RS_CMD);
    usleep(4500);
    lcd_send_nibble(0x30, LCD_RS_CMD);
    usleep(4500);
    lcd_send_nibble(0x30, LCD_RS_CMD);
    usleep(150);
    lcd_send_nibble(0x20, LCD_RS_CMD); // Switch to 4-bit mode

    // 2-line mode, 5x8 font
    lcd_send_byte(0x28, LCD_RS_CMD);
    // Display ON, cursor OFF, blink OFF
    lcd_send_byte(0x0C, LCD_RS_CMD);
    // Clear display
    lcd_send_byte(0x01, LCD_RS_CMD);
    usleep(2000);
    // Entry mode: auto-increment cursor
    lcd_send_byte(0x06, LCD_RS_CMD);
}

// Function callable from ARM64 Assembly: void lcd_print(const char *str);
void lcd_print(const char *str) {
    printf("[LCD DISPLAY]: \"%s\"\n", str);
    fflush(stdout);

    // 1. Forward to Arduino Uno LCD via backend UDP bridge (127.0.0.1:9001)
    char buf[96];
    snprintf(buf, sizeof(buf), "INST|%s", str);
    udp_send_pi_status(buf);

    // 2. Also write to direct Pi I2C (/dev/i2c-1) if wired directly
    lcd_init_i2c();
    if (i2c_fd >= 0) {
        // Clear display before printing
        lcd_send_byte(0x01, LCD_RS_CMD);
        usleep(2000);
        while (*str) {
            lcd_send_byte((unsigned char)(*str), LCD_RS_DATA);
            str++;
        }
    }
}
