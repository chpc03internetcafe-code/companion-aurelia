// Live chat with the concierge: a button in the corner of every page and a chat window.
// The chat belongs to this browser (an httpOnly cookie set by the API); localStorage only remembers that a chat
// exists and which replies were read, so visitors without a chat make no requests at all.
// New messages arrive by long polling (more slowly while the tab is hidden, without counting as read), along with
// the desk's read receipt ("Seen") and typing state. Answered by staff in CMS → Live chat.
// Replies that arrive while the window is closed or the tab is hidden: a count in the tab title, a soft chime
// (can be muted) and a preview bubble above the chat button.
// The concierge can send profile cards (View profile / Book). Outside desk hours the chat says when the desk is
// back and asks for an email. While the visitor writes, the desk sees "typing…".
// Ending the chat keeps it in this browser for 30 minutes so the visitor can rate it and email themselves the
// transcript; "Start a new chat" or "Remove from this device" forgets it sooner, and "Delete" erases it for good.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, store } from '../utils/api';
import { useSite } from '../context/SiteContext';
import { OPEN_CHAT_EVENT, takeChatContext } from '../utils/chat';
import { dateTime, duration, money } from '../utils/format';
import { Field, Photo } from './Common';
import { IconBell, IconChat, IconClose, IconLock, IconSend } from './Icons';

const ACTIVE_KEY = 'aurelia-chat';
const READ_KEY = 'aurelia-chat-read';
const MUTED_KEY = 'aurelia-chat-muted';
const RETRY_MS = 5000;
const HIDDEN_PAUSE_MS = 10_000; // between long polls while the tab is hidden
const TITLE_PREFIX = /^\(\d+\) New reply · /;
const TYPING_EVERY_MS = 3000; // how often the composer tells the desk "typing…" (the server shows it for 6 s)

// A two-note chime made with Web Audio (no sound file). Browsers only allow sound after the visitor has
// interacted, so the audio context is created on a click (unlockSound) and reused.
let audio = null;
function unlockSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    if (audio?.state === 'suspended') audio.resume();
  } catch { /* no sound */ }
}
function chime() {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  [880, 1320].forEach((freq, i) => {
    const start = t + i * 0.12;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

/** "(2) New reply · " in front of the page title while there are unread replies (kept when pages change the title). */
function useTitleCount(count) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_PREFIX, '');
      const want = count ? `(${count}) New reply · ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const el = count ? document.querySelector('title') : null;
    if (!el) return undefined;
    const watch = new MutationObserver(apply);
    watch.observe(el, { childList: true, characterData: true, subtree: true });
    return () => watch.disconnect();
  }, [count]);
}

/** Tells the desk that the visitor is writing: call typed(text) on every change, stop() when done. */
function useTypingSignal() {
  const sentAt = useRef(0);
  const ping = useCallback((typing) => api('POST', '/site/chat/typing', { typing }).catch(() => {}), []);
  const stop = useCallback(() => { if (sentAt.current) { sentAt.current = 0; ping(false); } }, [ping]);
  const typed = useCallback((text) => {
    if (!text.trim()) { stop(); return; }
    if (Date.now() - sentAt.current < TYPING_EVERY_MS) return;
    sentAt.current = Date.now();
    ping(true);
  }, [ping, stop]);
  return { typed, stop, sent: () => { sentAt.current = 0; } };
}

function useTabVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

export default function LiveChat() {
  const { site, ageOk, toast } = useSite();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('chat') === 'open');
  const [active, setActiveState] = useState(() => !!store.get(ACTIVE_KEY, false));
  const [thread, setThread] = useState(null); // { chat, messages, online }
  const [readId, setReadIdState] = useState(() => Number(store.get(READ_KEY, 0)) || 0);
  const [muted, setMutedState] = useState(() => !!store.get(MUTED_KEY, false));
  const [context, setContext] = useState(() => takeChatContext()); // { profileId, name } from "Chat about …"
  const [peekId, setPeekId] = useState(0); // the reply shown in the bubble above the chat button
  const visible = useTabVisible();
  const lastId = useRef(0);
  const known = useRef({ seen: 0, typing: false }); // what the window shows, so the long poll only answers on a change

  // "Chat now" buttons elsewhere on the site (utils/chat.js)
  useEffect(() => {
    const show = () => { const c = takeChatContext(); if (c) setContext(c); setOpen(true); };
    window.addEventListener(OPEN_CHAT_EVENT, show);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show);
  }, []);

  const setActive = (v) => { store.set(ACTIVE_KEY, v); setActiveState(v); };
  const setReadId = (v) => { store.set(READ_KEY, v); setReadIdState(v); };
  const setMuted = (v) => { store.set(MUTED_KEY, v); setMutedState(v); if (!v) unlockSound(); };

  const merge = useCallback((r, reset = false) => {
    setThread((cur) => {
      const base = reset || !cur ? [] : cur.messages;
      const ids = new Set(base.map((m) => m.id));
      const messages = [...base, ...(r.messages || []).filter((m) => !ids.has(m.id))];
      lastId.current = messages.length ? messages[messages.length - 1].id : 0;
      const chat = r.chat === undefined ? cur?.chat ?? null : r.chat;
      known.current = { seen: chat?.seenId || 0, typing: !!chat?.typing };
      return { chat, messages, online: r.online ?? cur?.online ?? false, desk: r.desk ?? cur?.desk ?? null };
    });
  }, []);

  const forget = useCallback(() => {
    setActive(false);
    lastId.current = 0;
    setThread((cur) => ({ chat: null, messages: [], online: cur?.online ?? false, desk: cur?.desk ?? null }));
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

  // long poll while the chat is open; while the tab is hidden, more slowly and without marking replies as read
  const live = active && thread?.chat?.status === 'Open';
  useEffect(() => {
    if (!live) return undefined;
    let stopped = false;
    let wake = () => {};
    const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    const pause = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });
    (async () => {
      while (!stopped) {
        const hidden = document.visibilityState !== 'visible';
        try {
          const { seen, typing } = known.current;
          const r = await api('GET', `/site/chat/wait?after=${lastId.current}&seen=${seen}&typing=${typing ? 1 : 0}${hidden ? '&bg=1' : ''}`);
          if (!stopped) merge(r);
          if (r.chat?.status === 'Closed') break;
          if (hidden) await pause(HIDDEN_PAUSE_MS);
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
  const looking = open && visible;
  useEffect(() => { if (looking && latest > readId) setReadId(latest); }, [looking, latest, readId]);
  const unread = looking ? 0 : messages.filter((m) => m.from !== 'me' && m.id > readId).length;
  const replies = looking ? [] : messages.filter((m) => m.from === 'staff' && m.id > readId);
  const newestReply = replies.length ? replies[replies.length - 1] : null;
  useTitleCount(replies.length);

  // a new reply while the visitor isn't looking: chime, and the preview bubble when the window is closed
  const alerted = useRef(null); // the newest reply when the chat loaded, so replies read before don't chime
  useEffect(() => {
    if (!thread || thread.error) return;
    const id = newestReply?.id || 0;
    if (alerted.current === null || id <= alerted.current) { alerted.current = Math.max(alerted.current || 0, id); return; }
    alerted.current = id;
    if (!muted) chime();
    if (!open) setPeekId(id);
  }, [newestReply?.id, thread, muted, open]);
  const peek = !open && peekId && newestReply?.id === peekId ? newestReply : null;

  const hidden = site.liveChatEnabled !== '1' || (site.ageGateEnabled === '1' && !ageOk);
  if (hidden) return null;

  return (
    <>
      {open && (
        <ChatWindow thread={thread} greeting={site.liveChatGreeting} transcripts={site.liveChatTranscripts === '1'} pathname={pathname} toast={toast}
          context={context} onContext={setContext} muted={muted} onMute={() => setMuted(!muted)}
          onClose={() => setOpen(false)}
          onStarted={(r) => { merge(r, true); setActive(true); setContext(null); }}
          onSent={(r) => merge(r)}
          onForget={forget} />
      )}
      {peek && (
        <div className="lc-peek" role="status">
          <button type="button" className="lc-peek-body" onClick={() => { unlockSound(); setOpen(true); }}>
            <strong>{peek.name || 'Concierge'}</strong>
            <span>{peek.body || (peek.card ? `Sent you a profile: ${peek.card.name}` : '')}</span>
          </button>
          <button type="button" className="icon-btn lc-peek-close" onClick={() => setPeekId(0)} aria-label="Dismiss"><IconClose size={14} /></button>
        </div>
      )}
      <button type="button" className={`lc-launcher${open ? ' is-open' : ''}${unread > 0 && !open ? ' has-unread' : ''}`} aria-expanded={open} aria-controls="live-chat"
        onClick={() => { unlockSound(); setOpen((o) => !o); }} aria-label={open ? 'Close the chat' : unread ? `Chat with the concierge, ${unread} new` : 'Chat with the concierge'}>
        {open ? <IconClose size={22} /> : <IconChat size={22} />}
        {!open && <span className="lc-launcher-label">Chat</span>}
        {unread > 0 && !open && <b className="lc-badge" aria-hidden="true">{unread}</b>}
      </button>
    </>
  );
}

function ChatWindow({ thread, greeting, transcripts, pathname, toast, context, onContext, muted, onMute, onClose, onStarted, onSent, onForget }) {
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const typingSignal = useTypingSignal();
  const chat = thread?.chat;
  const count = thread?.messages.length || 0;
  const typing = chat?.status === 'Open' && chat.typing;
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [count, !!chat, typing]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, !!chat]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Chat about …" while a chat is already running: start the next message with the profile's name
  useEffect(() => {
    if (!context || chat?.status !== 'Open') return;
    setText((t) => t || `About ${context.name}: `);
    onContext(null);
    inputRef.current?.focus();
  }, [context, chat?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // the visitor's last message, and whether the desk has read it
  const mine = thread?.messages.filter((m) => m.from === 'me') || [];
  const lastMine = mine.length ? mine[mine.length - 1] : null;
  const seen = !!lastMine && lastMine.id <= (chat?.seenId || 0);
  const lastMessageId = () => (thread.messages.length ? thread.messages[thread.messages.length - 1].id : 0);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    unlockSound();
    try {
      onSent(await api('POST', '/site/chat/messages', { body: text, after: lastMessageId() }));
      setText('');
      typingSignal.sent(); // sending clears "typing…" on the server
    } catch (err) {
      if (err.status === 404 || err.status === 409) onForget();
      toast(err.message, 'error');
    } finally { setBusy(false); }
  };
  // ends the chat but keeps it here, for the rating and the transcript
  const end = async () => {
    typingSignal.stop();
    try {
      onSent(await api('POST', '/site/chat/close', { after: lastMessageId() }));
    } catch (err) {
      if (err.status === 404) onForget();
      else toast(err.message, 'error');
    }
  };
  // forgets the ended chat in this browser and shows the start form
  const startOver = async () => {
    await api('POST', '/site/chat/end').catch(() => {});
    onForget();
  };

  return (
    <section id="live-chat" className="lc-panel" role="dialog" aria-label="Chat with the concierge">
      <header className="lc-head">
        <div>
          <strong>Concierge</strong>
          <span className="lc-status"><i className={`lc-dot${thread?.online ? ' on' : ''}`} aria-hidden="true" />
            {thread?.online ? 'Online now' : thread?.desk && !thread.desk.open ? `Away${thread.desk.opensAt ? ` · back ${thread.desk.opensAt}` : ''}` : 'We’ll reply as soon as we can'}</span>
        </div>
        {chat?.status === 'Open' && <button type="button" className="link lc-end" onClick={end}>End chat</button>}
        <button type="button" className={`icon-btn lc-mute${muted ? ' is-muted' : ''}`} onClick={onMute} aria-pressed={!muted}
          aria-label="Reply sounds" title={muted ? 'Reply sounds off' : 'Reply sounds on'}><IconBell size={17} /></button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close the chat"><IconClose size={18} /></button>
      </header>

      {!thread ? <div className="lc-body"><p className="muted lc-center">Loading…</p></div>
        : thread.error ? <div className="lc-body"><p className="muted lc-center">The chat couldn’t be loaded. Please try again later.</p></div>
        : !chat ? <StartForm desk={thread.desk} greeting={greeting} pathname={pathname} inputRef={inputRef} toast={toast} context={context} onContext={onContext} onStarted={onStarted} />
        : (
          <>
            <div className="lc-body lc-list" ref={listRef} aria-live="polite">
              {chat.profile && <p className="lc-context">About <Link to={`/companions/${chat.profile.slug}`}>{chat.profile.name}</Link></p>}
              {thread.messages.map((m) => (m.from === 'system' ? (
                <p key={m.id} className="lc-system">{m.body}</p>
              ) : (
                <div key={m.id} className={`chat-msg ${m.from === 'me' ? 'me' : ''}${m.card ? ' has-card' : ''}`}>
                  {m.card && <ProfileCard p={m.card} />}
                  {m.body && <div className="chat-bubble">{m.body}</div>}
                  <small>{m.from === 'me' ? 'You' : m.name} · {dateTime(m.at)}{m === lastMine && seen ? ' · Seen' : ''}</small>
                </div>
              )))}
              {typing && (
                <div className="chat-msg lc-typing">
                  <div className="chat-bubble" aria-hidden="true"><i /><i /><i /></div>
                  <small>Concierge is typing…</small>
                </div>
              )}
            </div>
            {chat.status === 'Open' ? (
              <form className="lc-form" onSubmit={send}>
                <textarea ref={inputRef} className="input" rows={2} maxLength={2000} value={text} placeholder="Write a message…" aria-label="Message"
                  onChange={(e) => { setText(e.target.value); typingSignal.typed(e.target.value); }} onBlur={typingSignal.stop}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
                <button className="btn btn-primary lc-send" disabled={busy || !text.trim()} aria-label="Send"><IconSend size={18} /></button>
              </form>
            ) : (
              <ChatEnded chat={chat} transcripts={transcripts} after={lastMessageId} toast={toast} onUpdated={onSent} onForget={onForget} onStartOver={startOver}
                onDeleted={() => { onForget(); toast('Your chat was deleted.'); }} />
            )}
          </>
        )}
      <p className="lc-note"><IconLock size={13} /> Messages are encrypted and only read by our concierge.</p>
    </section>
  );
}

/** After the chat has ended: rate it, email the transcript (once, when the desk allows it), or start a new chat. */
function ChatEnded({ chat, transcripts, after, toast, onUpdated, onForget, onStartOver, onDeleted }) {
  const [confirming, setConfirming] = useState(false); // "Delete for good?"
  const [comment, setComment] = useState('');
  const [commented, setCommented] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [busy, setBusy] = useState('');
  const call = async (what, path, body) => {
    if (busy) return null;
    setBusy(what);
    try {
      const r = await api('POST', path, { ...body, after: after() });
      onUpdated(r);
      return r;
    } catch (err) {
      if (err.status === 404) onForget();
      if (err.details?.email) setEmailError(err.details.email);
      else toast(err.message, 'error');
      return null;
    } finally { setBusy(''); }
  };
  const rate = (rating) => call('rate', '/site/chat/rate', { rating });
  const sendComment = async (e) => {
    e.preventDefault();
    if (comment.trim() && await call('comment', '/site/chat/rate', { rating: chat.rating, comment })) setCommented(true);
  };
  const remove = async () => {
    if (busy) return;
    setBusy('delete');
    try {
      await api('POST', '/site/chat/delete');
      onDeleted();
    } catch (err) {
      if (err.status === 404) onForget();
      else toast(err.message, 'error');
    } finally { setBusy(''); }
  };
  const transcript = async (e) => {
    e?.preventDefault();
    setEmailError('');
    if (await call('transcript', '/site/chat/transcript', chat.email ? {} : { email })) toast('Transcript sent. Check your inbox.');
  };

  return (
    <div className="lc-closed lc-ended">
      <p>This chat has ended.</p>
      <div className="lc-rate">
        <span>{chat.rating ? 'Thanks for your feedback.' : 'How was your chat?'}</span>
        <div className="lc-rate-btns" role="group" aria-label="Rate this chat">
          {[['Good', '👍', 'Good'], ['Bad', '👎', 'Not good']].map(([value, icon, label]) => (
            <button key={value} type="button" className={`lc-rate-btn${chat.rating === value ? ' on' : ''}`} aria-pressed={chat.rating === value}
              disabled={!!busy} onClick={() => rate(value)} aria-label={label} title={label}><span aria-hidden="true">{icon}</span></button>
          ))}
        </div>
      </div>
      {chat.rating && !commented && (
        <form className="lc-inline-form" onSubmit={sendComment}>
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000}
            placeholder={chat.rating === 'Bad' ? 'What could we do better? (optional)' : 'Anything to add? (optional)'} aria-label="Comment" />
          <button className="btn btn-ghost btn-sm" disabled={!comment.trim() || !!busy}>Send</button>
        </form>
      )}
      {!transcripts ? null : chat.transcriptSent ? <p className="lc-ended-note">The transcript was emailed to you.</p>
        : chat.email ? (
          <button type="button" className="link lc-transcript" disabled={!!busy} onClick={() => transcript()}>
            {busy === 'transcript' ? 'Sending…' : `Email me this conversation (${chat.email})`}
          </button>
        ) : (
          <form className="lc-inline-form" onSubmit={transcript} noValidate>
            <input className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(''); }} maxLength={254}
              placeholder="Email me this conversation" aria-label="Email for the transcript" aria-invalid={!!emailError} autoComplete="email" />
            <button className="btn btn-ghost btn-sm" disabled={!email.trim() || !!busy}>{busy === 'transcript' ? 'Sending…' : 'Send'}</button>
          </form>
        )}
      {emailError && <p className="lc-ended-error" role="alert">{emailError}</p>}
      <button type="button" className="btn btn-primary btn-sm" onClick={onStartOver}>Start a new chat</button>
      {confirming ? (
        <div className="lc-privacy" role="alert">
          <span>Delete this conversation for good? Our concierge won’t be able to see it either.</span>
          <button type="button" className="link lc-danger" disabled={!!busy} onClick={remove}>{busy === 'delete' ? 'Deleting…' : 'Yes, delete'}</button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <div className="lc-privacy">
          <span>Removed from this device 30 minutes after it ends.</span>
          <button type="button" className="link" onClick={onStartOver}>Remove now</button>
          <button type="button" className="link lc-danger" onClick={() => setConfirming(true)}>Delete for good</button>
        </div>
      )}
    </div>
  );
}

const aboutText = (name) => `Hi, I’d like to know more about ${name}.`;

/** A profile suggested by the concierge, with links to the profile and the booking form. */
function ProfileCard({ p }) {
  const place = p.location ? p.location.name : null;
  return (
    <div className="lc-card">
      <Link to={`/companions/${p.slug}`} className="lc-card-media"><Photo src={p.photoUrl} alt={p.photoAlt} name={p.name} /></Link>
      <div className="lc-card-body">
        <strong>{p.name} <span>{p.age}</span></strong>
        <small>{[place, p.category?.name].filter(Boolean).join(' · ')}</small>
        <small>{p.priceFrom != null ? <>from <b>{money(p.priceFrom)}</b>{p.minDuration ? ` / ${duration(p.minDuration)}` : ''}</> : 'Rates on request'}</small>
        <div className="lc-card-actions">
          <Link to={`/companions/${p.slug}`} className="btn btn-ghost btn-sm">View profile</Link>
          <Link to={`/book/${p.slug}`} className="btn btn-primary btn-sm">Book</Link>
        </div>
      </div>
    </div>
  );
}

function StartForm({ desk, greeting, pathname, inputRef, toast, context, onContext, onStarted }) {
  const away = desk && !desk.open;
  const [form, setForm] = useState({ name: '', email: '', message: context ? aboutText(context.name) : '', website: '' });
  const [errors, setErrors] = useState({});
  // "Chat about" another profile while the form is open: suggest a new first message unless the visitor wrote their own
  const prefill = useRef(form.message);
  useEffect(() => {
    if (!context) return;
    const next = aboutText(context.name);
    setForm((f) => (!f.message.trim() || f.message === prefill.current ? { ...f, message: next } : f));
    prefill.current = next;
  }, [context?.profileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    unlockSound();
    try {
      onStarted(await api('POST', '/site/chat', { ...form, page: pathname, profileId: context?.profileId }));
    } catch (err) {
      setErrors(err.details || {});
      if (!Object.keys(err.details || {}).length) toast(err.message, 'error');
    } finally { setBusy(false); }
  };
  return (
    <form className="lc-body lc-start" onSubmit={submit} noValidate>
      {away ? (
        <div className="chat-msg lc-away"><div className="chat-bubble">
          {desk.awayMessage || 'We’re away right now. Leave your message and email, and we’ll reply as soon as we’re back.'}
          {desk.opensAt && <small>Back {desk.opensAt} (Philippine time)</small>}
        </div></div>
      ) : greeting && <div className="chat-msg"><div className="chat-bubble">{greeting}</div></div>}
      {context && (
        <p className="lc-context">About <strong>{context.name}</strong>
          <button type="button" className="icon-btn" onClick={() => onContext(null)} aria-label={`Not about ${context.name}`}><IconClose size={13} /></button>
        </p>
      )}
      <Field label="Your name" error={errors.name} required><input ref={inputRef} className="input" value={form.name} onChange={set('name')} maxLength={150} autoComplete="name" /></Field>
      <Field label={away ? 'Email' : 'Email (optional)'} required={away} error={errors.email}
        hint={away ? 'We’ll email you as soon as we reply' : 'So we can let you know if you leave before we reply'}><input className="input" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="email" /></Field>
      <Field label="Message" error={errors.message} required>
        <textarea className="input" rows={3} maxLength={2000} value={form.message} onChange={set('message')} />
      </Field>
      <label className="honeypot" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
      <button className="btn btn-primary" disabled={busy || !form.message.trim()}>{busy ? 'Starting…' : 'Start chat'}</button>
    </form>
  );
}
