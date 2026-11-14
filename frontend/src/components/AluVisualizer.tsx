import React from 'react';
import { StepEvent } from '../types/debugger';

interface Props {
  lastEvent?: StepEvent;
}

export const AluVisualizer: React.FC<Props> = ({ lastEvent }) => {
  if (!lastEvent || !lastEvent.instruction) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-slate-400 text-xs text-center flex items-center justify-center h-full">
        Step an instruction to view ALU execution breakdown
      </div>
    );
  }

  const instruction = lastEvent.instruction;
  const parts = instruction.trim().split(/\s+/);
  const mnemonic = parts[0]?.toUpperCase() || '';
  const operands = parts.slice(1).join(' ');

  const isAlu = ['ADD', 'SUB', 'MUL', 'CMP', 'MOV', 'AND', 'ORR', 'EOR'].includes(mnemonic);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-full">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          ALU Execution Breakdown
        </h3>
        <span className="text-[10px] text-slate-400 font-mono">Real Process State Snapshot</span>
      </div>

      <div className="my-2 p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col md:flex-row items-center justify-around gap-3 text-center">
        {/* Source Operands */}
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase font-bold text-slate-500">Operands</span>
          <div className="text-xs font-mono font-bold text-sky-800 mt-1">
            {operands || 'None'}
          </div>
        </div>

        {/* Operation Symbol / Block */}
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase font-bold text-slate-500">Operation</span>
          <div className="mt-1 px-3 py-1 rounded bg-amber-100 text-amber-900 font-mono font-bold text-sm border border-amber-300 shadow-xs">
            {mnemonic}
          </div>
        </div>

        {/* Destination / Changes */}
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase font-bold text-slate-500">Result Target</span>
          <div className="text-xs font-mono font-bold text-emerald-700 mt-1">
            {lastEvent.changed_registers.length > 0
              ? lastEvent.changed_registers.map(d => `${d.reg} = ${d.new_decimal} (${d.new_value})`).join(', ')
              : isAlu ? 'Flags updated / None changed' : 'No register change'}
          </div>
        </div>
      </div>

      <div className="text-[10px] text-slate-500 italic text-center">
        Educational representation derived from inspected AArch64 registers before and after step #{lastEvent.step_number}.
      </div>
    </div>
  );
};
