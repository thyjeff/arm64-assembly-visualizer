// api.ts - Central connection layer for the ARM64 Visualizer portal.
//
// The portal can talk to:
//   - A same-origin backend (portal served by the device itself, base = '')
//   - A remote backend entered via the Connect Device dialog (base = full URL)
//   - Nothing (Demo Mode - the built-in simulator takes over)

const STORAGE_KEY = 'arm64_api_base';

/** Read the persisted backend base URL ('' = same-origin). */
export function getApiBase(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persist the backend base URL ('' = same-origin). */
export function setApiBase(url: string): void {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable - session only
  }
}

/** Build a full HTTP URL for an API path given a base ('' = same-origin). */
export function fullUrl(base: string, path: string): string {
  const clean = base ? base.replace(/\/+$/, '') : '';
  return clean + path;
}

/** Build a WebSocket URL for a path given a base ('' = same-origin). */
export function wsUrlFor(base: string, path: string): string {
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
  }
  return base.replace(/^http/, 'ws').replace(/\/+$/, '') + path;
}

export interface DeviceHealth {
  status: string;
  hostname?: string;
  arch?: string;
}

/** Probe a backend /api/health. Returns health info or null if unreachable. */
export async function probeBackend(base: string, timeoutMs = 2500): Promise<DeviceHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(fullUrl(base, '/api/health'), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.status === 'online') return data as DeviceHealth;
    return null;
  } catch {
    return null;
  }
}
