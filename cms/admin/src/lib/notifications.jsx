// Live staff notifications (booking requests, cancellations, booking chat, contact messages, live chat).
//
// Keeps one long-poll request open to GET /api/notifications/wait; the API answers within ~2 s of a
// new notification (or after ~20 s with nothing) and the loop asks again. New ones show as a pop-up
// with a chime, as a desktop notification when the CMS tab is in the background (if allowed), and
// fire a `cms:notification` window event so pages can refresh.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';

const NotificationsContext = createContext(null);
export const NOTIFY_MODULES = ['bookings', 'inquiries'];
export const MODULE_ICONS = { bookings: '📅', inquiries: '✉' };
const BELL_SIZE = 15;
const POP_MS = 8000;
const SOUND_KEY = 'cms-notification-sound';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
// With several CMS tabs open, only the first tab to see a notification plays the sound.
const claim = (id) => {
  const k = `cms-notified-${id}`;
  if (store.get(k)) return false;
  store.set(k, '1');
  setTimeout(() => { try { localStorage.removeItem(k); } catch { /* ignore */ } }, 60_000);
  return true;
};

let audioCtx;
function chime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [[660, 0], [990, 0.12]].forEach(([freq, at]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.16, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.4);
    });
  } catch { /* audio unavailable */ }
}

const desktopSupported = typeof window !== 'undefined' && 'Notification' in window;

export function NotificationsProvider({ children }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const enabled = NOTIFY_MODULES.some((m) => can(m));
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [pops, setPops] = useState([]);
  const [connected, setConnected] = useState(true);
  const [sound, setSoundState] = useState(store.get(SOUND_KEY) !== 'off');
  const [permission, setPermission] = useState(desktopSupported ? Notification.permission : 'unsupported');
  const lastId = useRef(0);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const setSound = (on) => { setSoundState(on); store.set(SOUND_KEY, on ? 'on' : 'off'); };
  const enableDesktop = async () => { if (desktopSupported) setPermission(await Notification.requestPermission()); };

  // The bell lists unread notifications only; this refills it from the server.
  const loadUnread = useCallback(async () => {
    const r = await api.get('/notifications', { unread: 1, limit: BELL_SIZE });
    setItems(r.items);
    setUnread(r.unread);
    return r;
  }, []);

  const open = useCallback((n) => {
    if (!n.isRead) {
      setItems((list) => list.filter((x) => x.id !== n.id));
      api.post('/notifications/read', { ids: [n.id] }).then(() => loadUnread()).catch(() => {});
    }
    setPops((p) => p.filter((x) => x.id !== n.id));
    if (n.link) navigate(n.link);
  }, [navigate, loadUnread]);

  const markAllRead = useCallback(async () => {
    const r = await api.post('/notifications/read', { all: true });
    setItems([]);
    setUnread(r.unread);
    window.dispatchEvent(new CustomEvent('cms:notifications-read'));
  }, []);
  const syncUnread = useCallback((n) => setUnread(n), []);

  const arrive = useCallback((fresh) => {
    if (!fresh.length) return;
    lastId.current = Math.max(lastId.current, ...fresh.map((n) => n.id));
    setItems((list) => [...fresh, ...list.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, BELL_SIZE));
    window.dispatchEvent(new CustomEvent('cms:notification', { detail: { modules: [...new Set(fresh.map((n) => n.module))], items: fresh } }));
    const shown = fresh.slice(0, 3);
    setPops((p) => [...shown, ...p].slice(0, 4));
    shown.forEach((n) => setTimeout(() => setPops((p) => p.filter((x) => x.id !== n.id)), POP_MS));
    if (!claim(fresh[0].id)) return;
    if (soundRef.current) chime();
    if (desktopSupported && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      for (const n of shown) {
        const d = new Notification(n.title, { body: n.body || '', tag: `cms-${n.id}` });
        d.onclick = () => { window.focus(); open(n); d.close(); };
      }
    }
  }, [open]);

  useEffect(() => {
    if (!user || !enabled) return undefined;
    let stopped = false;
    let controller;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      let delay = 0;
      while (!stopped) {
        try {
          if (!lastId.current) {
            const r = await loadUnread();
            if (stopped) return;
            lastId.current = r.latestId || -1;
          }
          controller = new AbortController();
          const res = await fetch(`/api/notifications/wait?after=${Math.max(lastId.current, 0)}`, { signal: controller.signal, cache: 'no-store' });
          if (res.status === 401) { window.dispatchEvent(new Event('auth:expired')); return; }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (stopped) return;
          setConnected(true);
          setUnread(data.unread);
          arrive(data.items);
          delay = 0;
        } catch (e) {
          if (stopped || e.name === 'AbortError') return;
          setConnected(false);
          delay = Math.min(delay ? delay * 2 : 3000, 30000);
          await sleep(delay);
        }
      }
    })();
    return () => { stopped = true; controller?.abort(); };
  }, [user?.id, enabled, arrive, loadUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NotificationsContext.Provider value={{ enabled, items, unread, connected, open, markAllRead, syncUnread, sound, setSound, permission, enableDesktop }}>
      {children}
      {pops.length > 0 && (
        <div className="notif-pops" role="status" aria-live="polite">
          {pops.map((n) => (
            <div key={n.id} className={`notif-pop mod-${n.module}`}>
              <button type="button" className="notif-pop-main" onClick={() => open(n)}>
                <i aria-hidden="true">{MODULE_ICONS[n.module]}</i>
                <span><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}</span>
              </button>
              <button type="button" className="icon-x" aria-label="Dismiss" onClick={() => setPops((p) => p.filter((x) => x.id !== n.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);

/** Re-runs `fn` when a notification for one of `modules` arrives (e.g. reload a list page). */
export function useLiveRefresh(modules, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = [].concat(modules).join(',');
  useEffect(() => {
    const wanted = key.split(',');
    const on = (e) => { if (e.detail.modules.some((m) => wanted.includes(m))) ref.current(); };
    window.addEventListener('cms:notification', on);
    return () => window.removeEventListener('cms:notification', on);
  }, [key]);
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(d) {
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  if (s > -45) return 'just now';
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= secs || unit === 'minute') return rtf.format(Math.round(s / secs), unit);
  }
  return '';
}
