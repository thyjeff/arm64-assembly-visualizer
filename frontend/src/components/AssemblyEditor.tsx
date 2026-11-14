import React from 'react';

interface Props {
  code: string;
  onChange: (val: string) => void;
  currentAddress?: string;
  currentInstruction?: string;
  onSelectPreset: (presetKey: string) => void;
  activePreset: string;
}

export const AssemblyEditor: React.FC<Props> = ({
  code,
  onChange,
  currentAddress,
  currentInstruction,
  onSelectPreset,
  activePreset
}) => {
  const lines = code.split('\n');

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col h-full">
      {/* Header and Template Tabs */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <h2 className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-wider uppercase">
            AArch64 Assembly Source
          </h2>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
          <button
            onClick={() => onSelectPreset('arithmetic')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'arithmetic'
                ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            1. Arithmetic
          </button>
          <button
            onClick={() => onSelectPreset('file')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'file'
                ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            2. File Creation (Syscall)
          </button>
          <button
            onClick={() => onSelectPreset('gpio')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'gpio'
                ? 'bg-white dark:bg-slate-700 text-amber-700 dark:text-amber-300 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            3. GPIO LED
          </button>
          <button
            onClick={() => onSelectPreset('lcd')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'lcd'
                ? 'bg-white dark:bg-slate-700 text-cyan-700 dark:text-cyan-300 shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            4. I2C LCD (Hello World)
          </button>
        </div>
      </div>

      {/* Current Instruction Banner */}
      {currentInstruction && (
        <div className="mb-2 text-xs font-mono bg-sky-50 dark:bg-sky-500/10 border border-sky-300 dark:border-sky-500/40 px-3 py-1.5 rounded-lg text-sky-900 dark:text-sky-200 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-600 dark:bg-sky-400 animate-pulse"></span>
            <span>Current Instruction:</span>
            <strong className="font-bold text-sky-800 dark:text-sky-100">{currentInstruction}</strong>
          </div>
          <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold">{currentAddress}</span>
        </div>
      )}

      {/* Editor Body */}
      <div className="flex-1 flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs shadow-inner">
        {/* Line Numbers */}
        <div className="bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500 select-none py-3 px-2.5 text-right border-r border-slate-200 dark:border-slate-800">
          {lines.map((_, i) => (
            <div key={i} className="leading-5">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text Area */}
        <textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 p-3 leading-5 resize-none outline-none font-mono whitespace-pre overflow-auto selection:bg-sky-100 dark:selection:bg-sky-500/30"
        />
      </div>
    </div>
  );
};
