// Signs staff out after a stretch without activity (minutes: Site settings → Security).
// The time of the last activity is kept in localStorage, so it's shared by every CMS tab: working in one tab keeps the
// others signed in, and a session left open when the browser was closed ends on the next visit.
import { useEffect, useRef, useState } from 'react';

const KEY = 'aurelia-cms-last-active';
const WARN_MS = 60_000;
const WRITE_EVERY_MS = 5_000;
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

let memory = 0; // fallback when storage is blocked
const lastActive = () => {
  try { return Number(localStorage.getItem(KEY)) || memory; } catch { return memory; }
};
/** Records activity now (also called on sign-in, so a stale time from an earlier visit never signs out a new session). */
export const markActive = () => {
  memory = Date.now();
  try { localStorage.setItem(KEY, String(memory)); } catch { /* storage unavailable */ }
};

// Real interaction only — loading a page, live notifications and polling don't count.
let written = 0;
const onActivity = () => {
  if (Date.now() - written < WRITE_EVERY_MS) return;
  written = Date.now();
  markActive();
};
for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });

/**
 * Calls onTimeout once `minutes` pass without activity; 0 or empty turns it off.
 * Returns the seconds left during the final minute, otherwise null.
 */
export function useIdleTimeout(minutes, onTimeout) {
  const [left, setLeft] = useState(null);
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  useEffect(() => {
    setLeft(null);
    if (!(minutes > 0)) return undefined;
    const limit = minutes * 60_000;
    if (!lastActive()) markActive();
    let done = false;
    const check = () => {
      if (done) return;
      const ms = limit - (Date.now() - lastActive());
      if (ms > 0) return setLeft(ms <= WARN_MS ? Math.ceil(ms / 1000) : null);
      done = true;
      setLeft(null);
      cb.current();
    };
    check();
    const t = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check); // background tabs run timers late
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, [minutes]);
  return left;
}

export function IdleWarning({ seconds, onSignOut }) {
  if (seconds == null) return null;
  return (
    <div className="modal-backdrop" style={{ zIndex: 120 }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-text">
        <h3 id="idle-title">Still there?</h3>
        <p id="idle-text" className="muted">For security you’ll be signed out in <strong>{seconds} second{seconds === 1 ? '' : 's'}</strong> because there’s been no activity. Unsaved changes will be lost.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onSignOut}>Sign out now</button>
          <button className="btn btn-primary" onClick={markActive} autoFocus>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
