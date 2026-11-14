import React, { useState, useEffect, useRef } from 'react';
import { RegisterViewer } from './components/RegisterViewer';
import { AssemblyEditor } from './components/AssemblyEditor';
import { ControlToolbar, BuildState } from './components/ControlToolbar';
import { AluVisualizer } from './components/AluVisualizer';
import { ExecutionTimeline } from './components/ExecutionTimeline';
import { ConnectDeviceDialog } from './components/ConnectDeviceDialog';
import { RegisterSnapshot, StepEvent, RegisterDiff } from './types/debugger';
import { AArch64Simulator } from './simulator/aarch64';
import { getApiBase, setApiBase, fullUrl, wsUrlFor, probeBackend, DeviceHealth } from './api';

const SAMPLE_ARITHMETIC = `// 01_arithmetic.s - Native AArch64 Arithmetic Demonstration
.global _start
.text

_start:
    // Step 1: Load 10 into X0
    mov     x0, #10

    // Step 2: Load 20 into X1
    mov     x1, #20

    // Step 3: Add X0 and X1, store result (30) in X2
    add     x2, x0, x1

    // Step 4: Copy X2 into X3. Notice X2 retains 30, and X3 becomes 30.
    mov     x3, x2

    // Step 5: Subtract X0 (10) from X2 (30), store in X4
    sub     x4, x2, x0

    // Step 6: Multiply X0 (10) and X1 (20), store in X5
    mul     x5, x0, x1

    // Step 7: Compare X2 and X3 (both 30) -> sets Zero & Carry flags
    cmp     x2, x3

    // Clean exit via Linux AArch64 syscall 93
    mov     x8, #93
    mov     x0, #0
    svc     #0
`;

const SAMPLE_FILE_CREATION = `// 04_create_file.s - Linux Syscalls: Create & Write Text File on Pi 5
.global _start

.data
filename:
    .asciz  "output_demo.txt"

message:
    .ascii  "Hello from Raspberry Pi 5 native AArch64 assembly!\\nCreated via Linux Syscalls.\\n"
msg_end:
    .equ    msg_len, msg_end - message

.text
_start:
    // 1. sys_openat (Syscall 56) to create output_demo.txt
    mov     x0, #-100           // AT_FDCWD (relative to current directory)
    ldr     x1, =filename       // Pointer to filename string
    mov     x2, #0x241          // O_WRONLY | O_CREAT | O_TRUNC
    mov     x3, #0x1a4          // Permissions 0644 (rw-r--r--)
    mov     x8, #56             // Syscall 56: openat
    svc     #0                  // Kernel returns file descriptor (fd) in X0

    mov     x19, x0             // Save fd in X19

    // 2. sys_write (Syscall 64) to write text to file
    mov     x0, x19             // File descriptor in X0
    ldr     x1, =message        // Buffer pointer in X1
    mov     x2, #msg_len        // Byte count in X2
    mov     x8, #64             // Syscall 64: write
    svc     #0                  // Kernel returns bytes written in X0

    // 3. sys_close (Syscall 57)
    mov     x0, x19             // File descriptor in X0
    mov     x8, #57             // Syscall 57: close
    svc     #0

    // 4. sys_exit (Syscall 93)
    mov     x0, #0
    mov     x8, #93
    svc     #0
`;

const SAMPLE_GPIO = `// 03_gpio_led.s - AArch64 GPIO Control Demonstration
// Calls documented C helper: void led_set(int state);
.global main
.type main, %function

main:
    // Function prologue: save FP (x29) and LR (x30)
    stp     x29, x30, [sp, #-16]!
    mov     x29, sp

    // 1. Turn LED ON
    mov     x0, #1
    bl      led_set

    // 2. Wait 1 second (1,000,000 microseconds)
    ldr     x0, =1000000
    bl      usleep

    // 3. Turn LED OFF
    mov     x0, #0
    bl      led_set

    // 4. Wait 1 second
    ldr     x0, =1000000
    bl      usleep

    // Function epilogue: restore FP and LR, return
    mov     x0, #0
    ldp     x29, x30, [sp], #16
    ret
`;

const SAMPLE_LCD = `// 05_i2c_lcd_hello.s - Print "Hello World!" on 16x2 I2C LCD from ARM64 Assembly
.global main
.type main, %function

.data
greeting:
    .asciz  "Hello World!"

.text
main:
    // Function prologue: save Frame Pointer (x29) and Link Register (x30)
    stp     x29, x30, [sp, #-16]!
    mov     x29, sp

    // Pass string address in register X0 (AArch64 AAPCS calling convention)
    ldr     x0, =greeting

    // Call LCD driver helper: void lcd_print(const char *str);
    bl      lcd_print

    // Return cleanly
    mov     x0, #0
    ldp     x29, x30, [sp], #16
    ret
`;

export const App: React.FC = () => {
  const [activePreset, setActivePreset] = useState<string>('arithmetic');
  const [code, setCode] = useState<string>(SAMPLE_ARITHMETIC);
  const [lastBuiltCode, setLastBuiltCode] = useState<string>('');
  const [buildState, setBuildState] = useState<BuildState>('unbuilt');
  const [isDebugging, setIsDebugging] = useState(false);
  const [isHalted, setIsHalted] = useState(false);
  const [statusText, setStatusText] = useState('Idle');
  const [ledState, setLedState] = useState(0);

  const [currentSnapshot, setCurrentSnapshot] = useState<RegisterSnapshot | undefined>();
  const [lastChanged, setLastChanged] = useState<RegisterDiff[]>([]);
  const [history, setHistory] = useState<StepEvent[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [currentAddress, setCurrentAddress] = useState<string>('');
  const [buildErrors, setBuildErrors] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);

  // ---- Theme (light / dark) ----
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('arm64_theme') as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('arm64_theme', theme);
    } catch {
      // storage unavailable
    }
    const t = setTimeout(() => root.classList.remove('theme-transition'), 250);
    return () => clearTimeout(t);
  }, [theme]);

  const GITHUB_URL = 'https://github.com/thyjeff/arm64-assembly-visualizer';

  // ---- Device connection / Demo Mode ----
  // deviceConnected === null  -> still checking
  // deviceConnected === true  -> live backend reachable (same-origin or remote URL)
  // deviceConnected === false -> Demo Mode (browser simulator)
  const [deviceConnected, setDeviceConnected] = useState<boolean | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceHealth | null>(null);
  const [apiBase, setApiBaseState] = useState<string>('');
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const liveRef = useRef(false);
  const simulatorRef = useRef<AArch64Simulator | null>(null);

  const setLive = (v: boolean) => {
    liveRef.current = v;
    setDeviceConnected(v);
  };

  /** All HTTP calls go through here so a remote backend URL works too. */
  const api = (path: string): string => fullUrl(apiBase, path);

  const switchToDemo = (reason: string) => {
    if (!liveRef.current) return;
    setLive(false);
    setInfoBanner(reason + ' Switched to Demo Mode: the built-in AArch64 simulator will run your code.');
  };

  const getSim = (): AArch64Simulator => {
    if (!simulatorRef.current) simulatorRef.current = new AArch64Simulator();
    return simulatorRef.current;
  };

  // Probe for a backend: saved URL first, then same-origin, else Demo Mode
  useEffect(() => {
    const probe = async () => {
      const saved = getApiBase();
      if (saved) {
        const info = await probeBackend(saved);
        if (info) {
          setApiBaseState(saved);
          setDeviceInfo(info);
          setLive(true);
          return;
        }
        setApiBase(''); // saved target is gone - fall back to probing
        setApiBaseState('');
      }
      const local = await probeBackend('');
      if (local) {
        setDeviceInfo(local);
        setLive(true);
      } else {
        setDeviceInfo(null);
        setLive(false);
      }
    };
    probe();
    window.addEventListener('focus', probe);
    return () => window.removeEventListener('focus', probe);
  }, []);

  const handleConnect = async (url: string): Promise<string | null> => {
    const clean = url.replace(/\/+$/, '');
    const info = await probeBackend(clean, 3000);
    if (!info) {
      return `No backend responded at ${clean} within 3 seconds.`;
    }
    setApiBase(clean);
    setApiBaseState(clean);
    setDeviceInfo(info);
    setLive(true);
    setIsDebugging(false);
    setIsHalted(false);
    setInfoBanner(`Connected to ${info.hostname || 'device'} (${info.arch || '?'}) at ${clean}`);
    return null;
  };

  const handleDisconnect = () => {
    setApiBase('');
    setApiBaseState('');
    setDeviceInfo(null);
    setLive(false);
    setIsDebugging(false);
    setIsHalted(false);
    setStatusText('Stopped');
    setInfoBanner('Disconnected. Running in Demo Mode with the built-in simulator.');
  };

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    if ((buildState === 'done' || buildState === 'already_done') && newCode !== lastBuiltCode) {
      setBuildState('modified');
      setInfoBanner('Code modified. Click Re-Assemble & Link to compile your changes.');
    }
  };

  const handleSelectPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    let newCode = SAMPLE_ARITHMETIC;
    if (presetKey === 'arithmetic') newCode = SAMPLE_ARITHMETIC;
    else if (presetKey === 'file') newCode = SAMPLE_FILE_CREATION;
    else if (presetKey === 'gpio') newCode = SAMPLE_GPIO;
    else if (presetKey === 'lcd') newCode = SAMPLE_LCD;
    setCode(newCode);
    setBuildState('unbuilt');
    setLastBuiltCode('');
    setInfoBanner(null);
    handleStop();
  };

  // WebSocket for real-time synchronization (live mode only)
  useEffect(() => {
    if (deviceConnected !== true) return;
    const wsUrl = wsUrlFor(apiBase, '/ws/session');
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'step_event') {
            const stepEvt: StepEvent = msg.data;
            setCurrentSnapshot(stepEvt.snapshot_after);
            setLastChanged(stepEvt.changed_registers);
            setCurrentInstruction(stepEvt.instruction);
            setCurrentAddress(stepEvt.address);
            if (stepEvt.is_halted) {
              setIsHalted(true);
              setStatusText(`Process Halted (Exit Code: ${stepEvt.exit_code ?? 0})`);
            }
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };
    } catch (e) {
      console.warn('WS connection failed, falling back to REST:', e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [deviceConnected, apiBase]);

  const handleBuild = async () => {
    // If the code has not changed since last successful build, notify user it's already done
    if (code === lastBuiltCode && (buildState === 'done' || buildState === 'already_done')) {
      setBuildState('already_done');
      setInfoBanner('Already Done: Machine code is already assembled and up to date. You can directly click 2. Start Debugger!');
      setStatusText('Already Built & Linked');
      return;
    }

    setBuildState('building');
    setBuildErrors(null);
    setStatusText('Assembling...');

    // ---- Demo Mode: simulate the build locally ----
    if (!liveRef.current) {
      const err = getSim().load(code);
      if (err) {
        setBuildErrors(err);
        setBuildState('failed');
        setInfoBanner('Demo build failed: the simulator could not parse this program.');
        setStatusText('Build Failed');
      } else {
        setLastBuiltCode(code);
        setBuildState('done');
        setInfoBanner('Demo build complete! The simulator parsed your program. Click 2. Start Debugger to step through it.');
        setStatusText('Built (Demo Mode)');
      }
      return;
    }

    setInfoBanner('Assembling & Linking: Generating native AArch64 ELF binary on Raspberry Pi 5...');

    try {
      const res = await fetch(api('/api/build'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly_code: code, target_type: 'standalone' })
      });
      const data = await res.json();
      if (!data.success) {
        setBuildErrors(data.errors || 'Build failed');
        setBuildState('failed');
        setInfoBanner('Build Failed: Please review the assembler error diagnostics below.');
        setStatusText('Build Failed');
      } else {
        setLastBuiltCode(code);
        setBuildState('done');
        setInfoBanner('Done! Executable ELF binary built successfully on Pi 5. Click 2. Start Debugger to inspect execution.');
        setStatusText('Built & Linked (Done)');
      }
    } catch (e: any) {
      switchToDemo('Connection Error: Failed to reach backend on Raspberry Pi 5.');
      setBuildState('unbuilt');
      setStatusText('Demo Mode');
    }
  };

  const handleStart = async () => {
    // ---- Demo Mode ----
    if (!liveRef.current) {
      const sim = getSim();
      const err = sim.load(code);
      if (err) {
        setBuildErrors(err);
        setBuildState('failed');
        return;
      }
      setIsDebugging(true);
      setIsHalted(false);
      setHistory([]);
      setSelectedStep(null);
      setCurrentSnapshot(sim.snapshot());
      setLastChanged([]);
      setStatusText('Demo: Paused at first instruction');
      setInfoBanner('Demo Mode: simulated AArch64 is paused at the entry point. Click Step Instruction to execute.');
      return;
    }

    try {
      const res = await fetch(api('/api/debug/start'), { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setIsDebugging(true);
        setIsHalted(false);
        setHistory([]);
        setSelectedStep(null);
        setCurrentSnapshot(data.snapshot);
        setLastChanged([]);
        setStatusText('Debugging (Paused at _start / main)');
        setInfoBanner('Debugger Running: Stopped at entry point. Click Step Instruction (or press F10) to execute one by one.');
      } else {
        alert(data.detail || 'Failed to start debugger. Make sure you assembled first.');
      }
    } catch (e: any) {
      switchToDemo('Error starting debugger: ' + e.message);
      setIsDebugging(false);
    }
  };

  const handleStep = async () => {
    // ---- Demo Mode ----
    if (!liveRef.current) {
      const sim = getSim();
      try {
        const event = sim.step();
        setHistory(prev => [...prev, event]);
        setCurrentSnapshot(event.snapshot_after);
        setLastChanged(event.changed_registers);
        setCurrentInstruction(event.instruction);
        setCurrentAddress(event.address);
        if (event.is_halted) {
          setIsHalted(true);
          setStatusText(`Demo: Program Halted (Exit Code: ${event.exit_code ?? 0})`);
          setInfoBanner(`Demo execution complete: program exited with code ${event.exit_code ?? 0}.`);
        } else {
          setStatusText(`Demo: Step #${event.step_number} Completed`);
        }
      } catch (e: any) {
        alert('Simulator: ' + e.message);
      }
      return;
    }

    try {
      const res = await fetch(api('/api/debug/step'), { method: 'POST' });
      const event: StepEvent = await res.json();
      if (res.ok) {
        setHistory(prev => [...prev, event]);
        setCurrentSnapshot(event.snapshot_after);
        setLastChanged(event.changed_registers);
        setCurrentInstruction(event.instruction);
        setCurrentAddress(event.address);

        if (event.is_halted) {
          setIsHalted(true);
          setStatusText(`Process Halted (Exit Code: ${event.exit_code ?? 0})`);
          setInfoBanner(`Execution complete: Child process exited cleanly with code ${event.exit_code ?? 0}.`);
        } else {
          setStatusText(`Step #${event.step_number} Completed`);
        }
      } else {
        alert((event as any).detail || 'Step error');
      }
    } catch (e: any) {
      switchToDemo('Error stepping instruction: ' + e.message);
    }
  };

  const handleRun = async () => {
    // ---- Demo Mode: run until halt ----
    if (!liveRef.current) {
      const sim = getSim();
      const events = sim.run();
      if (events.length > 0) {
        setHistory(prev => [...prev.slice(0, 400), ...events.slice(0, 400)]);
        const last = events[events.length - 1];
        setCurrentSnapshot(last.snapshot_after);
        setCurrentInstruction(last.instruction);
        setCurrentAddress(last.address);
        setIsHalted(true);
        setStatusText(`Demo: Program Halted (Exit Code: ${last.exit_code ?? 0})`);
        setInfoBanner(`Demo execution complete: ${events.length} instructions executed, exit code ${last.exit_code ?? 0}.`);
      }
      return;
    }

    try {
      const res = await fetch(api('/api/debug/continue'), { method: 'POST' });
      const event: StepEvent = await res.json();
      if (res.ok) {
        setHistory(prev => [...prev, event]);
        setCurrentSnapshot(event.snapshot_after);
        if (event.is_halted) {
          setIsHalted(true);
          setStatusText(`Process Halted (Exit Code: ${event.exit_code ?? 0})`);
          setInfoBanner(`Execution complete: program ran to completion (exit code ${event.exit_code ?? 0}). Check the LCD output!`);
        } else {
          setStatusText('Running / Stopped');
        }
      } else {
        alert((event as any).detail || 'Run error');
      }
    } catch (e: any) {
      switchToDemo('Error running program: ' + e.message);
    }
  };

  const handleStop = async () => {
    if (!liveRef.current) {
      getSim().reset();
      setIsDebugging(false);
      setIsHalted(false);
      setStatusText('Stopped (Demo)');
      return;
    }
    try {
      await fetch(api('/api/debug/stop'), { method: 'POST' });
      setIsDebugging(false);
      setIsHalted(false);
      setStatusText('Stopped');
    } catch (e) {
      console.error(e);
      setIsDebugging(false);
      setIsHalted(false);
      setStatusText('Stopped');
    }
  };

  const handleToggleLed = async (state: number) => {
    if (!liveRef.current) {
      setInfoBanner('Demo Mode: hardware control (LED / LCD) needs a connected Raspberry Pi.');
      return;
    }
    try {
      const res = await fetch(api('/api/gpio/led'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });
      const data = await res.json();
      if (data.success) {
        setLedState(state);
      }
    } catch (e) {
      console.error('Error toggling LED:', e);
    }
  };

  const handleSelectStep = (stepNumber: number) => {
    setSelectedStep(stepNumber);
    const evt = history.find(h => h.step_number === stepNumber);
    if (evt) {
      setCurrentSnapshot(evt.snapshot_after);
      setLastChanged(evt.changed_registers);
    }
  };

  const latestEvent = history.length > 0 ? history[history.length - 1] : undefined;
  const displayEvent = selectedStep !== null
    ? history.find(h => h.step_number === selectedStep)
    : latestEvent;

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 p-3 gap-3 transition-colors">
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-sm font-bold tracking-wide text-slate-900 dark:text-slate-50 leading-tight">
              ARM64 Architecture Visualizer
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
              Raspberry Pi 5 (AArch64) + Arduino + Native GDB/MI Instruction Stepper
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-slate-600 dark:text-slate-300 flex items-center gap-2.5">
          {/* Device connection badge / Connect Device button */}
          <button
            onClick={() => setConnectDialogOpen(true)}
            title="Click to connect a device backend or disconnect"
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border font-semibold transition-all ${
              deviceConnected === null
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                : deviceConnected
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                : 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              deviceConnected === null
                ? 'bg-slate-400 animate-pulse'
                : deviceConnected
                ? 'bg-emerald-500'
                : 'bg-amber-500 animate-pulse'
            }`}></span>
            {deviceConnected === null
              ? 'Checking connection…'
              : deviceConnected
              ? `Connected: ${deviceInfo?.hostname || 'device'} (${deviceInfo?.arch || '?'})`
              : 'Demo Mode · No Device — Connect'}
          </button>
          <span className="hidden xl:inline">Target: <strong className="text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-500/30">AArch64 Linux</strong></span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span className="hidden xl:inline">Debugger: <strong className="text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-500/30">{deviceConnected ? 'GDB/MI' : 'Simulated'}</strong></span>

          {/* GitHub repository button */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span className="hidden sm:inline font-semibold">GitHub</span>
          </a>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-amber-300 transition-all"
          >
            {theme === 'light' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M17.6 5.6l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Control Toolbar */}
      <ControlToolbar
        onBuild={handleBuild}
        onStart={handleStart}
        onStep={handleStep}
        onRun={handleRun}
        onStop={handleStop}
        onToggleLed={handleToggleLed}
        buildState={buildState}
        isDebugging={isDebugging}
        isHalted={isHalted}
        statusText={statusText}
        ledState={ledState}
        demoMode={deviceConnected === false}
      />

      {/* Informational Feedback Alert */}
      {infoBanner && !buildErrors && (
        <div className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-all border ${
          buildState === 'done' || buildState === 'already_done'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40'
            : buildState === 'building'
            ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-500/40'
            : buildState === 'modified'
            ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
        }`}>
          <div className="flex items-center gap-2">
            {buildState === 'building' && (
              <svg className="animate-spin h-3.5 w-3.5 text-sky-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            <span>{infoBanner}</span>
          </div>
          <button
            onClick={() => setInfoBanner(null)}
            className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error banner if build failed */}
      {buildErrors && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/40 p-3 rounded-xl text-rose-800 dark:text-rose-300 text-xs font-mono whitespace-pre-wrap shadow-xs">
          <strong>Build Diagnostics:</strong>
          <div className="mt-1">{buildErrors}</div>
        </div>
      )}

      {/* Main Grid: Left = Assembly & Timeline, Right = Registers & ALU */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        {/* Left Column: Code Editor & Timeline */}
        <div className="lg:col-span-6 flex flex-col gap-3 h-full overflow-hidden">
          <div className="flex-1 min-h-0">
            <AssemblyEditor
              code={code}
              onChange={handleCodeChange}
              currentAddress={currentAddress}
              currentInstruction={currentInstruction}
              onSelectPreset={handleSelectPreset}
              activePreset={activePreset}
            />
          </div>
          <div className="h-48 min-h-48">
            <ExecutionTimeline
              history={history}
              selectedStep={selectedStep}
              onSelectStep={handleSelectStep}
            />
          </div>
        </div>

        {/* Right Column: Registers & ALU Breakdown */}
        <div className="lg:col-span-6 flex flex-col gap-3 h-full overflow-hidden">
          <div className="flex-1 min-h-0">
            <RegisterViewer
              snapshot={currentSnapshot}
              changedRegisters={lastChanged}
            />
          </div>
          <div className="h-44 min-h-44">
            <AluVisualizer lastEvent={displayEvent} />
          </div>
        </div>
      </div>

      {/* Connect Device dialog */}
      <ConnectDeviceDialog
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        connected={deviceConnected === true}
        currentUrl={apiBase}
        deviceInfo={deviceInfo}
      />
    </div>
  );
};
