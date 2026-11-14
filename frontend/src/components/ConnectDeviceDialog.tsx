import React, { useState } from 'react';
import { DeviceHealth } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Attempt a connection; returns an error message or null on success. */
  onConnect: (url: string) => Promise<string | null>;
  onDisconnect: () => void;
  connected: boolean;
  currentUrl: string;
  deviceInfo: DeviceHealth | null;
}

const DEFAULT_URL = 'http://169.254.100.2:8000';

const SETUP_COMMANDS = `git clone https://github.com/thyjeff/arm64-assembly-visualizer.git
cd arm64-assembly-visualizer
bash scripts/setup_arm_device.sh
# service auto-starts -> connect to http://<device-ip>:8000`;

export const ConnectDeviceDialog: React.FC<Props> = ({
  open,
  onClose,
  onConnect,
  onDisconnect,
  connected,
  currentUrl,
  deviceInfo
}) => {
  const [url, setUrl] = useState<string>(currentUrl || DEFAULT_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    const err = await onConnect(url.trim());
    setBusy(false);
    if (err) setError(err);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_COMMANDS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for browsers without the async clipboard API
      const ta = document.createElement('textarea');
      ta.value = SETUP_COMMANDS;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/70" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-lg mx-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Connect Device</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm font-bold px-1">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current state */}
          {connected && deviceInfo && (
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/40 rounded-lg p-3 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Connected: {deviceInfo.hostname || 'device'} ({deviceInfo.arch || 'unknown arch'})
              </div>
              <div className="mt-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">{currentUrl || 'same origin'}</div>
              <button
                onClick={() => { onDisconnect(); onClose(); }}
                className="mt-2 px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
              >
                Disconnect (use Demo Mode)
              </button>
            </div>
          )}

          {/* Connect form */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
              Backend URL
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                placeholder="http://169.254.100.2:8000"
                spellCheck={false}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-500/50"
              />
              <button
                onClick={handleConnect}
                disabled={busy || !url.trim()}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-xs font-bold text-white"
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              The backend must run on the device you want to target (it drives the local
              assembler, GDB and hardware). On the Pi it starts automatically at boot.
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 italic">
              Note: HTTPS-hosted pages (like GitHub Pages) can only run in Demo Mode —
              browsers block HTTP device connections from HTTPS pages. For hardware, use
              the portal served by the device or localhost.
            </p>
          </div>

          {error && (
            <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/40 rounded-lg p-3 text-xs text-rose-800 dark:text-rose-300">
              <strong>Could not connect:</strong>
              <div className="mt-1 font-mono text-[11px]">{error}</div>
              <div className="mt-2 text-[11px] font-sans">
                Check: device powered on · Ethernet/Wi-Fi link · backend service running
                (<code className="font-mono">systemctl status arm64-visualizer</code>).
              </div>
            </div>
          )}

          {/* Setup instructions for other devices */}
          <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Setting up a new device (any AArch64 Linux board)
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                  copied
                    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                }`}
                title="Copy setup commands to clipboard"
              >
                {copied ? (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3"/>
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 overflow-x-auto">{SETUP_COMMANDS}</pre>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              On an ARM device you can also simply open <code className="font-mono">http://localhost:8000</code>
              {' '}in its browser — the portal connects to the local backend automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
