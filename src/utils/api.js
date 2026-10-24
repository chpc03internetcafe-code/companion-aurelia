// Calls the API through the dev-server proxy (same origin, so httpOnly cookies such as the live chat's are sent).
export class ApiError extends Error {
  constructor(status, message, details, data) {
    super(message);
    this.status = status;
    this.details = details || {};
    this.data = data || {};
  }
}

export async function api(method, url, body, { headers } = {}) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body || headers ? { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'We couldn’t connect. Please check your connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.', data.details, data);
  return data;
}

export const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
  return s ? `?${s}` : '';
};

// Small, safe wrapper around localStorage (private windows and blocked storage fall back to memory).
const memory = new Map();
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? (memory.has(key) ? memory.get(key) : fallback) : JSON.parse(v);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// Remembers the email a guest used for a booking, so the status page opens directly after booking.
// Reference + email are what unlock a booking (view, cancel, reschedule), so they're kept in memory only,
// never in localStorage/sessionStorage: they're gone when the tab reloads or closes. Sign-in sessions are
// httpOnly cookies that page scripts can't read at all.
const lookups = new Map();
try { sessionStorage.removeItem('aurelia-lookup'); } catch { /* storage unavailable */ } // left by older versions
export const lookupEmail = {
  get: (ref) => lookups.get(ref) || '',
  set: (ref, email) => { lookups.set(ref, email); },
};
