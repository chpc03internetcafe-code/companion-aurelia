// Booking chat between the client and the concierge (on the booking status page).
// `path` is the API path of the thread (GET to read, POST to send); `extra` is added to both (e.g. the guest's email).
// New messages are fetched every few seconds while the tab is visible.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs } from '../utils/api';
import { useSite } from '../context/SiteContext';
import { dateTime } from '../utils/format';
import { Loading } from './Common';

const POLL_MS = 6000;

export default function Chat({ path, extra = {}, title = 'Messages', placeholder = 'Write a message…', hint, onRead }) {
  const { toast } = useSite();
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lastId = useRef(0);
  const listRef = useRef(null);
  const extraKey = JSON.stringify(extra);

  const merge = useCallback((r) => {
    setThread((cur) => {
      const known = new Set((cur?.messages || []).map((m) => m.id));
      const messages = [...(cur?.messages || []), ...r.messages.filter((m) => !known.has(m.id))];
      lastId.current = messages.length ? messages[messages.length - 1].id : 0;
      return { open: r.open, note: r.note, messages };
    });
    if (r.messages.length) onRead?.();
  }, [onRead]);

  const poll = useCallback(() => {
    // a guest's email is sent as a header so it stays out of URLs (and server logs)
    const { email, ...rest } = JSON.parse(extraKey);
    return api('GET', `${path}${qs({ ...rest, after: lastId.current || undefined })}`, null, email ? { headers: { 'X-Booking-Email': email } } : undefined).then(merge);
  }, [path, extraKey, merge]);

  useEffect(() => {
    lastId.current = 0;
    setThread(null);
    poll().catch(() => setThread({ open: false, note: 'The chat couldn’t be loaded. Please refresh the page.', messages: [] }));
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // keep the newest message in view
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [thread?.messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      merge(await api('POST', path, { ...extra, body: text, after: lastId.current }));
      setText('');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="panel chat">
      <h3>{title}</h3>
      {!thread ? <Loading /> : (
        <>
          <div className="chat-list" ref={listRef} aria-live="polite">
            {thread.messages.length ? thread.messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.from}`}>
                <div className="chat-bubble">{m.body}</div>
                <small>{m.from === 'me' ? 'You' : m.name} · {dateTime(m.at)}</small>
              </div>
            )) : <p className="muted chat-empty">{thread.open ? 'No messages yet. Say hello!' : 'No messages.'}</p>}
          </div>
          {thread.open ? (
            <form className="chat-form" onSubmit={send}>
              <textarea className="input" rows={2} value={text} maxLength={2000} placeholder={placeholder} aria-label="Message"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
              <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
            </form>
          ) : thread.note && <div className="notice">{thread.note}</div>}
          {hint && <p className="muted chat-hint">{hint}</p>}
        </>
      )}
    </div>
  );
}
