import React from 'react';

export type BuildState = 'unbuilt' | 'building' | 'done' | 'already_done' | 'failed' | 'modified';

interface Props {
  onBuild: () => void;
  onStart: () => void;
  onStep: () => void;
  onRun: () => void;
  onStop: () => void;
  onToggleLed: (state: number) => void;
  buildState: BuildState;
  isDebugging: boolean;
  isHalted: boolean;
  statusText: string;
  ledState: number;
  demoMode?: boolean;
}

export const ControlToolbar: React.FC<Props> = ({
  onBuild,
  onStart,
  onStep,
  onRun,
  onStop,
  onToggleLed,
  buildState,
  isDebugging,
  isHalted,
  statusText,
  ledState,
  demoMode = false
}) => {
  const isBuilding = buildState === 'building';

  // Dynamic button appearance & text based on build status
  const getBuildButtonContent = () => {
    switch (buildState) {
      case 'building':
        return (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin -ml-0.5 h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Assembling...</span>
          </span>
        );
      case 'done':
        return (
          <span className="flex items-center gap-1.5 text-emerald-100">
            <svg className="w-3.5 h-3.5 text-emerald-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>✓ Built & Linked (Done)</span>
          </span>
        );
      case 'already_done':
        return (
          <span className="flex items-center gap-1.5 text-emerald-100">
            <svg className="w-3.5 h-3.5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>✓ Already Done!</span>
          </span>
        );
      case 'modified':
        return (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse"></span>
            <span>Re-Assemble & Link</span>
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1.5 text-rose-100">
            <span>✕ Retry Assemble</span>
          </span>
        );
      default:
        return <span>1. Assemble & Link</span>;
    }
  };

  const getBuildButtonClass = () => {
    switch (buildState) {
      case 'done':
      case 'already_done':
        return 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700';
      case 'modified':
        return 'bg-amber-600 hover:bg-amber-700 text-white border-amber-700';
      case 'failed':
        return 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700';
      default:
        return 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
      {/* Primary Execution Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onBuild}
          disabled={isBuilding}
          className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-50 ${getBuildButtonClass()}`}
          title={
            buildState === 'done' || buildState === 'already_done'
              ? 'Code is already compiled and linked on the Pi.'
              : 'Compile assembly and link ELF executable on the Pi.'
          }
        >
          {getBuildButtonContent()}
        </button>

        <button
          onClick={onStart}
          disabled={isDebugging || (buildState !== 'done' && buildState !== 'already_done')}
          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-xs font-semibold text-white shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
          title={
            buildState !== 'done' && buildState !== 'already_done'
              ? 'Click 1. Assemble & Link first before starting debugger'
              : 'Launch GDB and pause at start'
          }
        >
          <span>2. Start Debugger</span>
        </button>

        <button
          onClick={onRun}
          disabled={!isDebugging || isHalted}
          className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-xs font-bold text-white shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
          title="Run the program until it exits (GDB -exec-continue)"
        >
          ▶ Run to Completion
        </button>

        <button
          onClick={onStep}
          disabled={!isDebugging || isHalted}
          className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-xs font-bold text-white shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
        >
          <span>Step Instruction (stepi)</span>
          <span className="text-[10px] bg-sky-700 px-1 py-0.5 rounded text-sky-100 font-normal">F10</span>
        </button>

        <button
          onClick={onStop}
          disabled={!isDebugging}
          className="px-3.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-xs font-semibold text-rose-700 border border-rose-200 transition-all active:scale-95"
        >
          Stop / Reset
        </button>
      </div>

      {/* Hardware & Session Status */}
      <div className="flex items-center gap-3">
        {/* Physical LED Status & Manual Toggle (live hardware only) */}
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-mono transition-all ${
            demoMode
              ? 'bg-slate-50 border-slate-200 text-slate-400 opacity-60'
              : ledState
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
          title={demoMode ? 'Demo Mode: no hardware connected' : 'External LED on BCM GPIO 17'}
        >
          <span className="font-semibold">LED (BCM 17):</span>
          <button
            onClick={() => onToggleLed(ledState ? 0 : 1)}
            disabled={demoMode}
            className={`w-3.5 h-3.5 rounded-full border transition-all ${
              demoMode
                ? 'bg-slate-200 border-slate-300 cursor-not-allowed'
                : ledState
                ? 'bg-amber-400 border-amber-500 shadow-sm shadow-amber-400'
                : 'bg-slate-300 border-slate-400 hover:bg-slate-400'
            }`}
            title={demoMode ? 'Disabled in Demo Mode (no hardware)' : 'Click to toggle LED manually'}
          />
          <span className={ledState && !demoMode ? 'text-amber-800 font-bold' : 'text-slate-500'}>
            {demoMode ? 'N/A' : ledState ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* State Badge */}
        <div className="text-xs font-mono px-3 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
          State: <span className="font-bold text-sky-700">{statusText}</span>
        </div>
      </div>
    </div>
  );
};
