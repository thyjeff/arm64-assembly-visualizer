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
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col h-full">
      {/* Header and Template Tabs */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-100 mb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <h2 className="text-xs font-bold text-slate-700 tracking-wider uppercase">
            AArch64 Assembly Source
          </h2>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
          <button
            onClick={() => onSelectPreset('arithmetic')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'arithmetic'
                ? 'bg-white text-sky-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Arithmetic
          </button>
          <button
            onClick={() => onSelectPreset('file')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'file'
                ? 'bg-white text-indigo-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. File Creation (Syscall)
          </button>
          <button
            onClick={() => onSelectPreset('gpio')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'gpio'
                ? 'bg-white text-amber-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            3. GPIO LED
          </button>
          <button
            onClick={() => onSelectPreset('lcd')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              activePreset === 'lcd'
                ? 'bg-white text-cyan-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            4. I2C LCD (Hello World)
          </button>
        </div>
      </div>

      {/* Current Instruction Banner */}
      {currentInstruction && (
        <div className="mb-2 text-xs font-mono bg-sky-50 border border-sky-300 px-3 py-1.5 rounded-lg text-sky-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-600 animate-pulse"></span>
            <span>Current Instruction:</span>
            <strong className="font-bold text-sky-800">{currentInstruction}</strong>
          </div>
          <span className="text-slate-500 text-[11px] font-semibold">{currentAddress}</span>
        </div>
      )}

      {/* Editor Body */}
      <div className="flex-1 flex overflow-hidden rounded-lg border border-slate-200 bg-white font-mono text-xs shadow-inner">
        {/* Line Numbers */}
        <div className="bg-slate-50 text-slate-400 select-none py-3 px-2.5 text-right border-r border-slate-200">
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
          className="flex-1 bg-white text-slate-800 p-3 leading-5 resize-none outline-none font-mono whitespace-pre overflow-auto selection:bg-sky-100"
        />
      </div>
    </div>
  );
};
