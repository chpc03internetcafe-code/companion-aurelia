// Live chat with the concierge: a button in the corner of every page and a chat window.
// The chat belongs to this browser (an httpOnly cookie set by the API); localStorage only remembers that a chat
// exists and which replies were read, so visitors without a chat make no requests at all.
// New messages arrive by long polling while the tab is visible. Answered by staff in CMS → Live chat.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, store } from '../utils/api';
import { useSite } from '../context/SiteContext';
import { dateTime } from '../utils/format';
import { Field } from './Common';
import { IconChat, IconClose, IconLock, IconSend } from './Icons';

const ACTIVE_KEY = 'aurelia-chat';
const READ_KEY = 'aurelia-chat-read';
const RETRY_MS = 5000;

export default function LiveChat() {
  const { site, member, ageOk, toast } = useSite();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('chat') === 'open');
  const [active, setActiveState] = useState(() => !!store.get(ACTIVE_KEY, false));
  const [thread, setThread] = useState(null); // { chat, messages, online }
  const [readId, setReadIdState] = useState(() => Number(store.get(READ_KEY, 0)) || 0);
  const lastId = useRef(0);

  const setActive = (v) => { store.set(ACTIVE_KEY, v); setActiveState(v); };
  const setReadId = (v) => { store.set(READ_KEY, v); setReadIdState(v); };

  const merge = useCallback((r, reset = false) => {
    setThread((cur) => {
      const base = reset || !cur ? [] : cur.messages;
      const known = new Set(base.map((m) => m.id));
      const messages = [...base, ...(r.messages || []).filter((m) => !known.has(m.id))];
      lastId.current = messages.length ? messages[messages.length - 1].id : 0;
      return { chat: r.chat === undefined ? cur?.chat ?? null : r.chat, messages, online: r.online ?? cur?.online ?? false };
    });
  }, []);

  const forget = useCallback(() => {
    setActive(false);
    lastId.current = 0;
    setThread((cur) => ({ chat: null, messages: [], online: cur?.online ?? false }));
  }, []);

  // first load: when the window is opened, or when this browser has a chat (for the unread badge)
  const wanted = open || active;
  useEffect(() => {
    if (!wanted || thread) return;
    api('GET', '/site/chat').then((r) => {
      merge(r, true);
      if (!r.chat) setActive(false);
    }).catch(() => setThread({ chat: null, messages: [], online: false, error: true }));
  }, [wanted, thread, merge]);

  // long poll while the chat is open and the tab is visible
  const live = active && thread?.chat?.status === 'Open';
  useEffect(() => {
    if (!live) return undefined;
    let stopped = false;
    let visible = document.visibilityState === 'visible';
    let wake = () => {};
    const onVisibility = () => { visible = document.visibilityState === 'visible'; if (visible) wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    const pause = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });
    (async () => {
      while (!stopped) {
        if (!visible) { await pause(60_000); continue; }
        try {
          const r = await api('GET', `/site/chat/wait?after=${lastId.current}`);
          if (!stopped) merge(r);
          if (r.chat?.status === 'Closed') break;
        } catch (err) {
          if (err.status === 404) { if (!stopped) forget(); break; }
          await pause(RETRY_MS);
        }
      }
    })();
    return () => { stopped = true; wake(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [live, merge, forget]);

  const messages = thread?.messages || [];
  const latest = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => { if (open && latest > readId) setReadId(latest); }, [open, latest, readId]);
  const unread = open ? 0 : messages.filter((m) => m.from !== 'me' && m.id > readId).length;

  const inPortal = pathname === '/companion' || pathname.startsWith('/companion/'); // the companion portal, not /companions
  const hidden = site.liveChatEnabled !== '1' || inPortal || (site.ageGateEnabled === '1' && !ageOk);
  if (hidden) return null;

  return (
    <>
      {open && (
        <ChatWindow thread={thread} member={member} greeting={site.liveChatGreeting} pathname={pathname} toast={toast}
          onClose={() => setOpen(false)}
          onStarted={(r) => { merge(r, true); setActive(true); }}
          onSent={(r) => merge(r)}
          onForget={forget} />
      )}
      <button type="button" className={`lc-launcher${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls="live-chat"
        onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close the chat' : unread ? `Chat with the concierge, ${unread} new` : 'Chat with the concierge'}>
        {open ? <IconClose size={22} /> : <IconChat size={22} />}
        {!open && <span className="lc-launcher-label">Chat</span>}
        {unread > 0 && <b className="lc-badge" aria-hidden="true">{unread}</b>}
      </button>
    </>
  );
}

function ChatWindow({ thread, member, greeting, pathname, toast, onClose, onStarted, onSent, onForget }) {
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const chat = thread?.chat;
  const count = thread?.messages.length || 0;
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [count, !!chat]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, !!chat]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const after = thread.messages.length ? thread.messages[thread.messages.length - 1].id : 0;
      onSent(await api('POST', '/site/chat/messages', { body: text, after }));
      setText('');
    } catch (err) {
      if (err.status === 404 || err.status === 409) onForget();
      toast(err.message, 'error');
    } finally { setBusy(false); }
  };
  const end = async () => {
    await api('POST', '/site/chat/end').catch(() => {});
    onForget();
  };

  return (
    <section id="live-chat" className="lc-panel" role="dialog" aria-label="Chat with the concierge">
      <header className="lc-head">
        <div>
          <strong>Concierge</strong>
          <span className="lc-status"><i className={`lc-dot${thread?.online ? ' on' : ''}`} aria-hidden="true" />{thread?.online ? 'Online now' : 'We’ll reply as soon as we can'}</span>
        </div>
        {chat?.status === 'Open' && <button type="button" className="link lc-end" onClick={end}>End chat</button>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close the chat"><IconClose size={18} /></button>
      </header>

      {!thread ? <div className="lc-body"><p className="muted lc-center">Loading…</p></div>
        : thread.error ? <div className="lc-body"><p className="muted lc-center">The chat couldn’t be loaded. Please try again later.</p></div>
        : !chat ? <StartForm member={member} greeting={greeting} pathname={pathname} inputRef={inputRef} toast={toast} onStarted={onStarted} />
        : (
          <>
            <div className="lc-body lc-list" ref={listRef} aria-live="polite">
              {thread.messages.map((m) => (m.from === 'system' ? (
                <p key={m.id} className="lc-system">{m.body}</p>
              ) : (
                <div key={m.id} className={`chat-msg ${m.from === 'me' ? 'me' : ''}`}>
                  <div className="chat-bubble">{m.body}</div>
                  <small>{m.from === 'me' ? 'You' : m.name} · {dateTime(m.at)}</small>
                </div>
              )))}
            </div>
            {chat.status === 'Open' ? (
              <form className="lc-form" onSubmit={send}>
                <textarea ref={inputRef} className="input" rows={2} maxLength={2000} value={text} placeholder="Write a message…" aria-label="Message"
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
                <button className="btn btn-primary lc-send" disabled={busy || !text.trim()} aria-label="Send"><IconSend size={18} /></button>
              </form>
            ) : (
              <div className="lc-closed">
                <p>This chat has ended.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={end}>Start a new chat</button>
              </div>
            )}
          </>
        )}
      <p className="lc-note"><IconLock size={13} /> Messages are encrypted and only read by our concierge.</p>
    </section>
  );
}

function StartForm({ member, greeting, pathname, inputRef, toast, onStarted }) {
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      onStarted(await api('POST', '/site/chat', { ...form, page: pathname }));
    } catch (err) {
      setErrors(err.details || {});
      if (!Object.keys(err.details || {}).length) toast(err.message, 'error');
    } finally { setBusy(false); }
  };
  return (
    <form className="lc-body lc-start" onSubmit={submit} noValidate>
      {greeting && <div className="chat-msg"><div className="chat-bubble">{greeting}</div></div>}
      {member ? (
        <p className="muted lc-as">Chatting as <strong>{member.fullName}</strong></p>
      ) : (
        <>
          <Field label="Your name" error={errors.name} required><input ref={inputRef} className="input" value={form.name} onChange={set('name')} maxLength={150} autoComplete="name" /></Field>
          <Field label="Email (optional)" error={errors.email} hint="So we can let you know if you leave before we reply"><input className="input" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="email" /></Field>
        </>
      )}
      <Field label="Message" error={errors.message} required>
        <textarea ref={member ? inputRef : undefined} className="input" rows={3} maxLength={2000} value={form.message} onChange={set('message')} />
      </Field>
      <label className="honeypot" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
      <button className="btn btn-primary" disabled={busy || !form.message.trim()}>{busy ? 'Starting…' : 'Start chat'}</button>
    </form>
  );
}
