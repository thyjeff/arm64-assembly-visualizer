/*
 * lcd_monitor.ino - Arduino Uno firmware for ARM64 Assembly Visualizer
 * Receives line-oriented commands over USB Serial from Raspberry Pi 5.
 *
 * Protocol (Pi -> Arduino):
 *   INST|<instruction text>   -> shows instruction on top row
 *   REG|<reg>|<val>           -> shows register value on bottom row
 *   GPIO|LED_ON / LED_OFF     -> shows GPIO event screen
 *   STATE|RUN / PAUSE / STOP  -> shows execution state on bottom row
 *   CLEAR                     -> clears display
 *   PING                      -> replies "PONG|ARM64-LCD" (no LCD update)
 *
 * Protocol (Arduino -> Pi):
 *   STATUS:ARDUINO_LCD_READY  -> sent once at boot
 *   ACK|<CMD>                 -> sent after processing each valid line
 *   ERR|UNKNOWN               -> sent for unrecognized commands
 */

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Common I2C addresses for PCF8574 backpack: 0x27 or 0x3F
#ifndef LCD_I2C_ADDR
#define LCD_I2C_ADDR 0x27
#endif

LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 16, 2);

static char serialBuffer[64];
static uint8_t bufferIndex = 0;

// Write a string into one LCD row (16 chars, space padded)
void showRow(uint8_t row, const char* text) {
  char padded[17];
  snprintf(padded, sizeof(padded), "%-16.16s", text);
  lcd.setCursor(0, row);
  lcd.print(padded);
}

// Keep only printable ASCII (0x20-0x7E); anything else becomes a space.
// This makes it impossible for corrupted bytes or control characters
// to render as garbage glyphs on the HD44780 display.
void sanitize(char* text) {
  for (; *text; text++) {
    if (*text < 0x20 || *text > 0x7E) *text = ' ';
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin();

  lcd.init();
  lcd.backlight();
  lcd.clear();

  // Splash screen
  showRow(0, "ARM64 EXECUTOR");
  showRow(1, "READY - STEP");

  Serial.println("STATUS:ARDUINO_LCD_READY");
}

void processLine(char* line) {
  if (strlen(line) == 0) return;

  // Split on delimiter '|'
  char* cmd = strtok(line, "|");
  if (!cmd) return;

  // Health-check command: does not touch the LCD
  if (strcmp(cmd, "PING") == 0) {
    Serial.println("PONG|ARM64-LCD");
    return;
  }

  if (strcmp(cmd, "INST") == 0) {
    char* inst = strtok(NULL, "|");
    if (inst) {
      sanitize(inst);
      // Clear first so program output (e.g. "Hello World!") shows alone
      lcd.clear();
      showRow(0, inst);
    }
  } else if (strcmp(cmd, "REG") == 0) {
    char* reg = strtok(NULL, "|");
    char* val = strtok(NULL, "|");
    if (reg && val) {
      sanitize(reg);
      sanitize(val);
      char displayBuf[17];
      snprintf(displayBuf, sizeof(displayBuf), "%s=%s", reg, val);
      showRow(1, displayBuf);
    }
  } else if (strcmp(cmd, "GPIO") == 0) {
    char* state = strtok(NULL, "|");
    if (state) {
      sanitize(state);
      const char* s = state;
      if (strncmp(s, "LED_", 4) == 0) s += 4;  // LED_ON -> ON
      showRow(0, "GPIO OPERATION");
      char displayBuf[17];
      snprintf(displayBuf, sizeof(displayBuf), "LED:%s", s);
      showRow(1, displayBuf);
    }
  } else if (strcmp(cmd, "STATE") == 0) {
    char* state = strtok(NULL, "|");
    if (state) {
      sanitize(state);
      showRow(1, state);
    }
  } else if (strcmp(cmd, "CLEAR") == 0) {
    // Full re-initialization: heals the HD44780 if it ever loses
    // 4-bit sync (e.g. after an I2C glitch or loose wire).
    lcd.init();
    lcd.backlight();
    lcd.clear();
  } else {
    Serial.println("ERR|UNKNOWN");
    return;
  }

  // Confirm successful processing back to the Pi
  Serial.print("ACK|");
  Serial.println(cmd);
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (bufferIndex > 0) {
        serialBuffer[bufferIndex] = '\0';
        processLine(serialBuffer);
        bufferIndex = 0;
      }
    } else {
      if (bufferIndex < sizeof(serialBuffer) - 1) {
        serialBuffer[bufferIndex++] = c;
      } else {
        bufferIndex = 0;  // overflow guard: drop the long line
      }
    }
  }
}
