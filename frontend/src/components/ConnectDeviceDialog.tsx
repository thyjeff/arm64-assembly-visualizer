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

  if (!open) return null;

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    const err = await onConnect(url.trim());
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50" onClick={onClose}>
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-lg mx-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Connect Device</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm font-bold px-1">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current state */}
          {connected && deviceInfo && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 text-xs text-emerald-900">
              <div className="font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Connected: {deviceInfo.hostname || 'device'} ({deviceInfo.arch || 'unknown arch'})
              </div>
              <div className="mt-1 font-mono text-[11px] text-emerald-700">{currentUrl || 'same origin'}</div>
              <button
                onClick={() => { onDisconnect(); onClose(); }}
                className="mt-2 px-2.5 py-1 rounded bg-white border border-emerald-300 text-emerald-800 font-semibold hover:bg-emerald-100"
              >
                Disconnect (use Demo Mode)
              </button>
            </div>
          )}

          {/* Connect form */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Backend URL
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                placeholder="http://169.254.100.2:8000"
                spellCheck={false}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              <button
                onClick={handleConnect}
                disabled={busy || !url.trim()}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-xs font-bold text-white"
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              The backend must run on the device you want to target (it drives the local
              assembler, GDB and hardware). On the Pi it starts automatically at boot.
            </p>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-300 rounded-lg p-3 text-xs text-rose-800">
              <strong>Could not connect:</strong>
              <div className="mt-1 font-mono text-[11px]">{error}</div>
              <div className="mt-2 text-[11px] font-sans">
                Check: device powered on · Ethernet/Wi-Fi link · backend service running
                (<code className="font-mono">systemctl status arm64-visualizer</code>).
              </div>
            </div>
          )}

          {/* Setup instructions for other devices */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-xs font-bold text-slate-700 mb-1">
              Setting up a new device (any AArch64 Linux board)
            </div>
            <pre className="text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded p-2 overflow-x-auto">{`git clone https://github.com/thyjeff/arm64-assembly-visualizer.git
cd arm64-assembly-visualizer
bash scripts/setup_arm_device.sh
# service auto-starts -> connect to http://<device-ip>:8000`}</pre>
            <p className="text-[11px] text-slate-500 mt-1.5">
              On an ARM device you can also simply open <code className="font-mono">http://localhost:8000</code>
              {' '}in its browser — the portal connects to the local backend automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
