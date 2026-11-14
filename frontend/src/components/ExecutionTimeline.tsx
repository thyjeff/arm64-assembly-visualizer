import React from 'react';
import { StepEvent } from '../types/debugger';

interface Props {
  history: StepEvent[];
  selectedStep: number | null;
  onSelectStep: (stepNumber: number) => void;
}

export const ExecutionTimeline: React.FC<Props> = ({
  history,
  selectedStep,
  onSelectStep
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-2">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
          Execution Timeline ({history.length} Steps)
        </h3>
        <span className="text-[10px] text-slate-400 font-mono">Click step to inspect history</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
        {history.length === 0 ? (
          <div className="text-slate-400 text-center py-6 text-xs italic">
            No instructions stepped yet.
          </div>
        ) : (
          history.map((evt) => {
            const isSelected = selectedStep === evt.step_number;
            return (
              <div
                key={evt.step_number}
                onClick={() => onSelectStep(evt.step_number)}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-sky-50 border-sky-400 text-sky-950 shadow-xs ring-1 ring-sky-300'
                    : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 text-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sky-700">Step #{evt.step_number}</span>
                  <span className="text-[10px] text-slate-400">{evt.address}</span>
                </div>
                <div className="font-semibold text-slate-900">{evt.instruction}</div>
                {evt.changed_registers.length > 0 && (
                  <div className="text-[11px] text-amber-800 font-medium mt-1">
                    Δ {evt.changed_registers.map(d => `${d.reg}: ${d.old_decimal} -> ${d.new_decimal}`).join(', ')}
                  </div>
                )}
                {evt.is_halted && (
                  <div className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded mt-1 font-bold inline-block">
                    Process Exited (code {evt.exit_code ?? 0})
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
