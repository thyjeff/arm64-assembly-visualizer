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
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-2">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
          Execution Timeline ({history.length} Steps)
        </h3>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">Click step to inspect history</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
        {history.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-500 text-center py-6 text-xs italic">
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
                    ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-400 dark:border-sky-500/60 text-sky-950 dark:text-sky-100 shadow-xs ring-1 ring-sky-300 dark:ring-sky-500/30'
                    : 'bg-slate-50/80 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sky-700 dark:text-sky-400">Step #{evt.step_number}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{evt.address}</span>
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{evt.instruction}</div>
                {evt.changed_registers.length > 0 && (
                  <div className="text-[11px] text-amber-800 dark:text-amber-400 font-medium mt-1">
                    Δ {evt.changed_registers.map(d => `${d.reg}: ${d.old_decimal} -> ${d.new_decimal}`).join(', ')}
                  </div>
                )}
                {evt.is_halted && (
                  <div className="text-[10px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/40 px-1.5 py-0.5 rounded mt-1 font-bold inline-block">
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
