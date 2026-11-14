export interface RegisterSnapshot {
  registers: Record<string, string>;
  decimal_values: Record<string, number>;
  pc: string;
  sp: string;
  flags: {
    N: boolean;
    Z: boolean;
    C: boolean;
    V: boolean;
  };
}

export interface RegisterDiff {
  reg: string;
  old_value: string;
  new_value: string;
  old_decimal: number;
  new_decimal: number;
}

export interface StepEvent {
  step_number: number;
  address: string;
  instruction: string;
  pc_before: string;
  pc_after: string;
  changed_registers: RegisterDiff[];
  snapshot_before: RegisterSnapshot;
  snapshot_after: RegisterSnapshot;
  is_halted: boolean;
  exit_code?: number;
  output?: string;
}

export interface BuildResponse {
  success: boolean;
  executable_path?: string;
  errors?: string;
  disassembly?: string;
}
