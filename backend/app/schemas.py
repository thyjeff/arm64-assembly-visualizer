from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

class RegisterSnapshot(BaseModel):
    # Mapping of register name (e.g. "x0", "pc", "sp", "cpsr") to hex string value
    registers: Dict[str, str] = Field(default_factory=dict)
    # Optional integer decimal values for quick display
    decimal_values: Dict[str, int] = Field(default_factory=dict)
    pc: str = "0x0"
    sp: str = "0x0"
    flags: Dict[str, bool] = Field(default_factory=dict) # N, Z, C, V

class RegisterDiff(BaseModel):
    reg: str
    old_value: str
    new_value: str
    old_decimal: int
    new_decimal: int

class StepEvent(BaseModel):
    step_number: int
    address: str
    instruction: str
    pc_before: str
    pc_after: str
    changed_registers: List[RegisterDiff] = Field(default_factory=list)
    snapshot_before: RegisterSnapshot
    snapshot_after: RegisterSnapshot
    is_halted: bool = False
    exit_code: Optional[int] = None
    output: Optional[str] = None

class BuildRequest(BaseModel):
    assembly_code: str
    target_type: str = "standalone" # "standalone" or "mixed_c"

class BuildResponse(BaseModel):
    success: bool
    executable_path: Optional[str] = None
    errors: Optional[str] = None
    disassembly: Optional[str] = None

class SessionState(BaseModel):
    status: str # "idle", "ready", "running", "paused", "stopped", "terminated"
    current_step: int = 0
    current_pc: str = "0x0"
    current_instruction: str = ""
    registers: RegisterSnapshot = Field(default_factory=RegisterSnapshot)
    history: List[StepEvent] = Field(default_factory=list)
