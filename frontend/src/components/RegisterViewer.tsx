import React from 'react';
import { RegisterSnapshot, RegisterDiff } from '../types/debugger';

interface Props {
  snapshot?: RegisterSnapshot;
  changedRegisters?: RegisterDiff[];
}

export const RegisterViewer: React.FC<Props> = ({ snapshot, changedRegisters = [] }) => {
  const changedSet = new Set(changedRegisters.map(d => d.reg.toLowerCase()));

  // 31 General Purpose Registers: X0 to X30
  const generalRegs = Array.from({ length: 31 }, (_, i) => `x${i}`);

  const getDiff = (reg: string) => {
    return changedRegisters.find(d => d.reg.toLowerCase() === reg.toLowerCase());
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
        <h2 className="text-xs font-bold text-sky-700 dark:text-sky-400 tracking-wider uppercase flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse"></span>
          ARM64 Registers (AArch64)
        </h2>

        {/* Condition Flags (PSTATE NZCV) */}
        <div className="flex gap-1.5 text-xs font-mono items-center">
          <span className="text-slate-500 dark:text-slate-400 font-semibold text-[11px]">PSTATE:</span>
          {['N', 'Z', 'C', 'V'].map((flag) => {
            const isSet = snapshot?.flags?.[flag as keyof typeof snapshot.flags];
            return (
              <span
                key={flag}
                className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  isSet
                    ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-transparent'
                }`}
                title={`Flag ${flag}: ${isSet ? '1 (Set)' : '0 (Cleared)'}`}
              >
                {flag}:{isSet ? '1' : '0'}
              </span>
            );
          })}
        </div>
      </div>

      {/* Special Registers: PC and SP */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`p-2.5 rounded-lg border text-xs font-mono transition-all ${
          changedSet.has('pc')
            ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-400 dark:border-sky-500/60 shadow-sm'
            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60'
        }`}>
          <div className="flex justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-bold text-sky-800 dark:text-sky-300">PC (Program Counter)</span>
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{snapshot?.pc || '0x0'}</div>
        </div>

        <div className={`p-2.5 rounded-lg border text-xs font-mono transition-all ${
          changedSet.has('sp')
            ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400 dark:border-indigo-500/60 shadow-sm'
            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60'
        }`}>
          <div className="flex justify-between text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-bold text-indigo-800 dark:text-indigo-300">SP (Stack Pointer)</span>
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{snapshot?.sp || '0x0'}</div>
        </div>
      </div>

      {/* X0-X30 Register Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {generalRegs.map((reg) => {
            const isChanged = changedSet.has(reg);
            const diff = getDiff(reg);
            const hexVal = snapshot?.registers?.[reg] || '0x0';
            const decVal = snapshot?.decimal_values?.[reg] ?? 0;

            return (
              <div
                key={reg}
                className={`p-2 rounded-lg border text-xs font-mono transition-all duration-200 ${
                  isChanged
                    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-400 dark:border-amber-500/60 shadow-sm ring-1 ring-amber-300 dark:ring-amber-500/30'
                    : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-bold ${isChanged ? 'text-amber-800 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400'}`}>
                    {reg.toUpperCase()}
                  </span>
                  {isChanged && (
                    <span className="text-[9px] bg-amber-200 dark:bg-amber-500/25 text-amber-900 dark:text-amber-200 px-1 rounded font-bold">
                      UPDATED
                    </span>
                  )}
                </div>

                <div className="truncate text-slate-800 dark:text-slate-100 font-medium" title={hexVal}>
                  {hexVal}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1 pt-1 border-t border-slate-200/80 dark:border-slate-700/50">
                  <span>dec:</span>
                  <span className={isChanged ? 'text-amber-800 dark:text-amber-300 font-bold' : 'text-slate-700 dark:text-slate-300'}>
                    {decVal}
                  </span>
                </div>

                {diff && (
                  <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 italic">
                    Prev: {diff.old_decimal} ({diff.old_value})
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
