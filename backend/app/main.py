import asyncio
import logging
import socket
import threading
from typing import List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.schemas import (
    BuildRequest, BuildResponse, StepEvent, RegisterSnapshot, SessionState
)
from app.builder import AssemblyBuilder
from app.gdb_engine import GDBEngine
from app.hardware.gpio_manager import GPIOManager
from app.hardware.serial_lcd import SerialLCDPublisher
from app.config import (
    SERVER_HOST, SERVER_PORT, GPIO_CHIP, LED_GPIO_PIN,
    SERIAL_PORT, SERIAL_BAUDRATE, SERIAL_ENABLED
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ARM64Visualizer")

app = FastAPI(title="ARM64 Assembly Visualizer Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State & Singletons
builder = AssemblyBuilder()
gpio_mgr = GPIOManager(chip_path=GPIO_CHIP, pin_offset=LED_GPIO_PIN)
lcd_pub = SerialLCDPublisher(port=SERIAL_PORT, baudrate=SERIAL_BAUDRATE, enabled=SERIAL_ENABLED)

current_gdb: Optional[GDBEngine] = None
current_executable: Optional[str] = None
execution_history: List[StepEvent] = []
active_websockets: List[WebSocket] = []

async def broadcast_state(event_type: str, data: dict):
    payload = {"type": event_type, "data": data}
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_json(payload)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_websockets:
            active_websockets.remove(ws)

def _udp_lcd_listener():
    """
    UDP bridge (127.0.0.1:9001): receives status lines from native Assembly
    programs (via the lcd_print C helper) and forwards them to the Arduino
    LCD over USB serial. This lets the debugged process talk to the LCD
    without ever opening /dev/ttyACM0 itself (which would assert DTR and
    reset the Arduino mid-session).
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 9001))
        logger.info("UDP LCD bridge listening on 127.0.0.1:9001")
        while True:
            data, _ = sock.recvfrom(1024)
            line = data.decode("utf-8", errors="replace").strip()
            if line:
                lcd_pub.send_line(line)
    except Exception as e:
        logger.error(f"UDP LCD bridge stopped: {e}")

@app.on_event("startup")
async def startup_event():
    # Start the UDP bridge that native Assembly programs use to reach the LCD
    threading.Thread(target=_udp_lcd_listener, daemon=True).start()
    lcd_pub.send_state("READY")
    logger.info("ARM64 Visualizer Backend started successfully.")

@app.on_event("shutdown")
async def shutdown_event():
    global current_gdb
    if current_gdb:
        current_gdb.stop()
    gpio_mgr.cleanup()
    lcd_pub.send_state("STOPPED")
    lcd_pub.close()

@app.get("/api/health")
def read_root():
    return {
        "project": "ARM64 Assembly Computer Architecture Visualizer",
        "target": "Raspberry Pi 5 + Arduino",
        "status": "online"
    }

@app.post("/api/build", response_model=BuildResponse)
def build_assembly(req: BuildRequest):
    global current_executable
    res = builder.build_standalone(req.assembly_code)
    if res.success:
        current_executable = res.executable_path
    return res

@app.post("/api/debug/start")
async def start_debug():
    global current_gdb, execution_history
    if not current_executable:
        raise HTTPException(status_code=400, detail="No compiled executable available. Build first.")

    if current_gdb:
        current_gdb.stop()

    execution_history.clear()
    current_gdb = GDBEngine(current_executable)
    success = current_gdb.start()
    if not success:
        raise HTTPException(status_code=500, detail="Failed to initialize GDB on the executable.")

    lcd_pub.clear()  # Fresh LCD for this debug session
    snapshot = current_gdb.get_register_snapshot()

    state_data = {
        "status": "paused",
        "step": 0,
        "pc": snapshot.pc,
        "snapshot": snapshot.dict()
    }
    await broadcast_state("debug_started", state_data)
    return {"status": "started", "snapshot": snapshot}

@app.post("/api/debug/step", response_model=StepEvent)
async def step_debug():
    global current_gdb
    if not current_gdb or not current_gdb.is_running:
        raise HTTPException(status_code=400, detail="GDB session is not active. Start debug first.")

    event = current_gdb.step_instruction()
    execution_history.append(event)

    # Publish updates to Arduino LCD
    if event.instruction:
        lcd_pub.send_instruction(event.instruction)
    if event.changed_registers:
        first_change = event.changed_registers[0]
        lcd_pub.send_register(first_change.reg, str(first_change.new_decimal))

    if event.is_halted:
        lcd_pub.send_state("HALTED")

    await broadcast_state("step_event", event.dict())
    return event

@app.post("/api/debug/continue", response_model=StepEvent)
async def continue_debug():
    """
    Runs the debugged process until it exits or stops (Run to completion).
    """
    global current_gdb
    if not current_gdb or not current_gdb.is_running:
        raise HTTPException(status_code=400, detail="GDB session is not active. Start debug first.")

    event = current_gdb.continue_run()
    execution_history.append(event)

    # NOTE: no LCD status written here - whatever the program printed
    # via lcd_print (e.g. "Hello World!") stays on screen untouched.
    await broadcast_state("step_event", event.dict())
    return event

@app.post("/api/debug/stop")
async def stop_debug():
    global current_gdb
    if current_gdb:
        current_gdb.stop()
        current_gdb = None
    gpio_mgr.cleanup()
    lcd_pub.send_state("STOPPED")
    await broadcast_state("debug_stopped", {"status": "stopped"})
    return {"status": "stopped"}

@app.get("/api/debug/state")
def get_debug_state():
    if not current_gdb:
        return {"status": "idle", "history_count": len(execution_history)}
    snapshot = current_gdb.get_register_snapshot() if current_gdb.is_running else None
    return {
        "status": "running" if current_gdb.is_running else "halted",
        "current_step": current_gdb.current_step,
        "registers": snapshot,
        "history": execution_history
    }

class LEDRequest(BaseModel):
    state: int

@app.post("/api/gpio/led")
def set_led(req: LEDRequest):
    success = gpio_mgr.set_led(req.state)
    state_str = "LED_ON" if req.state else "LED_OFF"
    lcd_pub.send_gpio(state_str)
    return {"success": success, "state": req.state}

class LCDMessageRequest(BaseModel):
    line1: Optional[str] = None
    line2: Optional[str] = None

@app.post("/api/lcd/message")
def send_lcd_message(req: LCDMessageRequest):
    if req.line1:
        lcd_pub.send_instruction(req.line1)
    if req.line2:
        lcd_pub.send_state(req.line2)
    return {"status": "sent"}

@app.post("/api/lcd/test")
def lcd_test():
    """
    End-to-end LCD health check: sends PING over USB serial and expects
    'PONG|ARM64-LCD' back from the Arduino Uno.
    """
    reply = lcd_pub.ping()
    return {
        "arduino_connected": lcd_pub.is_connected,
        "pong_received": bool(reply and reply.startswith("PONG")),
        "reply": reply or ""
    }

@app.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Can receive client ping or direct step commands
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)

# Mount static frontend for 24/7 web portal access directly from Pi 5
from pathlib import Path
from fastapi.staticfiles import StaticFiles

frontend_dist_paths = [
    Path("/home/pi/arm64_visualizer/frontend_dist"),
    Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
]

for p in frontend_dist_paths:
    if p.exists() and (p / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(p), html=True), name="frontend")
        break

