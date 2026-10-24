// Long polling: a request stays open until `check()` returns something, or ~20 s pass.
// Works on Vercel (no WebSockets) and across instances, because every instance checks the database.
// Within one instance (local dev) waiters are woken immediately with poke().
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Wakes the requests waiting on `topic` in this instance. */
export const poke = (topic) => bus.emit(topic);

/**
 * Calls check() until it returns a truthy value or waitMs passes, then returns that value (or null).
 * Stops early when the client disconnects.
 */
export async function longPoll(req, res, topic, check, { waitMs = 20_000, everyMs = 2_000 } = {}) {
  let closed = false;
  res.on('close', () => { closed = true; });
  let wake = () => {};
  const onPoke = () => wake();
  bus.on(topic, onPoke);
  try {
    const until = Date.now() + waitMs;
    while (!closed) {
      const result = await check();
      if (result || Date.now() >= until) return result || null;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, Math.min(everyMs, until - Date.now()));
        wake = () => { clearTimeout(t); resolve(); };
      });
    }
    return null;
  } finally {
    bus.off(topic, onPoke);
  }
}
