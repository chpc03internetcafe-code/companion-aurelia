// Live chat with website visitors: conversations on the left, the open one on the right.
// New messages arrive through the CMS-wide live chat feed (long polling), so replies appear within a second or two.
// Staff can send a profile card (Profile button), shown on the website with View profile and Book buttons.
// Saved replies (components/ChatTemplates.jsx) can be inserted from the Templates button or by typing "/".
// Internal notes (the Note tab of the composer) are for staff only and can be added to closed chats too.
// Staff see when the visitor is typing, and the visitor's rating once the chat has ended.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime, money } from '../lib/format';
import { timeAgo } from '../lib/notifications';
import { Empty, ErrorBox, Field, KeyVals, Loading, Modal, PageHead, Pill, ProfilePicker, SearchBox, Tabs, Thumb, useAction, useLoad, useQueryState } from '../components/kit';
import { fillTemplate, matchTemplates, TemplatePicker, TemplatesModal } from '../components/ChatTemplates';
import { CHAT_FEED_EVENT, CHAT_TYPING_EVENT, typingChatIds } from '../lib/live-chat-feed';

const TYPING_EVERY_MS = 3000; // how often the composer tells the visitor "typing…" (the server shows it for 6 s)

/**
 * Calls onChange() whenever a live chat message arrives anywhere (the CMS-wide feed, lib/live-chat-feed.jsx).
 * Only while the tab is visible, since opening a chat marks it as read for the visitor ("Seen"); changes that came
 * in while the tab was hidden are fetched when it's shown again.
 */
function useChatFeed(onChange) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    let missed = false;
    const visible = () => document.visibilityState === 'visible';
    const onFeed = () => { if (visible()) ref.current(); else missed = true; };
    const onVisibility = () => { if (visible() && missed) { missed = false; ref.current(); } };
    window.addEventListener(CHAT_FEED_EVENT, onFeed);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener(CHAT_FEED_EVENT, onFeed); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
}

/** Ids of the chats whose visitor is typing right now (from the CMS-wide feed). */
function useTypingChats() {
  const [ids, setIds] = useState(typingChatIds);
  useEffect(() => {
    const on = (e) => setIds(e.detail.ids);
    window.addEventListener(CHAT_TYPING_EVENT, on);
    return () => window.removeEventListener(CHAT_TYPING_EVENT, on);
  }, []);
  return ids;
}

const RATING = { Good: '👍 Good', Bad: '👎 Bad' };

function ChatRow({ c, active, typing }) {
  return (
    <Link to={`/live-chat/${c.id}`} className={`lc-row${active ? ' on' : ''}${c.unread ? ' unread' : ''}`} aria-current={active ? 'true' : undefined}>
      <span className="lc-row-head">
        <strong>{c.visitorOnline && <i className="lc-online" title="On the website now" />}{c.visitorName}</strong>
        {c.unread > 0 ? <span className="pill pill-red">{c.unread} new</span> : <small className="muted">{timeAgo(c.lastMessageAt)}</small>}
      </span>
      <span className="lc-row-preview">{typing ? <em className="lc-row-typing">typing…</em> : <>{c.lastSender === 'Staff' ? 'You: ' : ''}{c.preview}</>}</span>
      <small className="muted">{c.reference}{c.profileName ? ` · about ${c.profileName}` : ''}{c.assignedName ? ` · ${c.assignedName}` : ''}{c.status === 'Closed' ? ' · closed' : ''}{c.rating ? ` · ${RATING[c.rating]}` : ''}</small>
    </Link>
  );
}

/** Tells the visitor that a reply is being written: call typed(text) on every change, stop() when done. */
function useTypingSignal(id) {
  const sentAt = useRef(0);
  const ping = useCallback((typing) => api.post(`/live-chat/${id}/typing`, { typing }).catch(() => {}), [id]);
  const stop = useCallback(() => { if (sentAt.current) { sentAt.current = 0; ping(false); } }, [ping]);
  const typed = useCallback((text) => {
    if (!text.trim()) return stop();
    if (Date.now() - sentAt.current < TYPING_EVERY_MS) return undefined;
    sentAt.current = Date.now();
    return ping(true);
  }, [ping, stop]);
  useEffect(() => stop, [stop]);
  return { typed, stop, sent: () => { sentAt.current = 0; } };
}

const websiteLink = (siteUrl, slug) => (siteUrl ? `${siteUrl.replace(/\/$/, '')}/companions/${slug}` : null);

/** A profile card in the thread, as staff see it. */
function SentCard({ p, siteUrl }) {
  const site = p.slug && websiteLink(siteUrl, p.slug);
  return (
    <div className="lc-sent-card">
      <Thumb src={p.photoUrl} name={p.name} w={40} h={50} />
      <span>
        <small className="muted">Profile card</small>
        <strong><Link to={`/profiles/${p.id}`}>{p.name}</Link></strong>
        {site && <a href={site} target="_blank" rel="noreferrer">View on the website ↗</a>}
      </span>
    </div>
  );
}

/** Choose a published profile and send it as a card, with an optional note (starts from the reply being written). */
function SendProfileModal({ chat, note: initialNote, after, onClose, onSent }) {
  const profiles = useLoad(() => api.get('/live-chat/profiles'), []);
  const [profileId, setProfileId] = useState(chat.profile ? String(chat.profile.id) : '');
  const [note, setNote] = useState(initialNote || '');
  const [error, setError] = useState('');
  const [run, busy] = useAction();
  // the profile the visitor asked about, if it's still published
  const list = profiles.data || [];
  const chosen = list.find((p) => p.id === Number(profileId));
  useEffect(() => { if (profiles.data && profileId && !chosen) setProfileId(''); }, [profiles.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!chosen) { setError('Choose a profile.'); return; }
    const r = await run(() => api.post(`/live-chat/${chat.id}/messages`, { profileId: chosen.id, body: note, after }), 'Profile card sent');
    if (r) onSent(r);
  };
  return (
    <Modal title="Send a profile card" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={send} disabled={busy || !chosen}>Send card</button></>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{chat.visitorName} sees the photo, rates from, and buttons to view the profile and book. Only published profiles can be sent.</p>
        {profiles.error ? <ErrorBox error={profiles.error} onRetry={profiles.reload} /> : (
          <Field label="Profile" error={error} required>
            <ProfilePicker profiles={list} loading={profiles.loading} value={profileId} onChange={(v) => { setProfileId(v); setError(''); }} />
          </Field>
        )}
        {chosen && <p className="muted" style={{ margin: 0 }}>{chosen.priceFrom != null ? `From ${money(chosen.priceFrom)}` : 'Rates on request'}{chosen.locationName ? ` · ${chosen.locationName}` : ''}</p>}
        <Field label="Note (optional)" hint="Sent with the card, e.g. “She’s free on Friday evening.”">
          <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Thread({ id, manage, onChanged, feedTick, siteUrl, templates, onManageTemplates, visitorTyping }) {
  const { user } = useAuth();
  const typing = useTypingSignal(id);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const [picker, setPicker] = useState(null); // { query, slash } while the template list is open
  const [pick, setPick] = useState(0);
  const [sharing, setSharing] = useState(false); // the "Send a profile card" window
  const [noteMode, setNoteMode] = useState(false); // the composer writes an internal note instead of a reply
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const lastId = useRef(0);
  const closePicker = useCallback(() => setPicker(null), []);

  const merge = useCallback((r, reset = false) => {
    setData((cur) => {
      const base = reset || !cur ? [] : cur.messages;
      const known = new Set(base.map((m) => m.id));
      const messages = [...base, ...r.messages.filter((m) => !known.has(m.id))];
      lastId.current = messages.length ? messages[messages.length - 1].id : 0;
      return { chat: r.chat, messages };
    });
  }, []);

  useEffect(() => {
    setData(null); setError(''); setText(''); lastId.current = 0;
    api.get(`/live-chat/${id}`).then((r) => { merge(r, true); onChanged(); }).catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // new messages somewhere: fetch this thread's new ones
  useEffect(() => {
    if (!feedTick || !data) return;
    api.get(`/live-chat/${id}`, { after: lastId.current }).then((r) => merge(r)).catch(() => {});
  }, [feedTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [data?.messages.length, visitorTyping]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading rows={4} />;
  const c = data.chat;
  const noting = noteMode || c.status !== 'Open'; // a closed chat only takes notes

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    if (noting) {
      const r = await run(() => api.post(`/live-chat/${id}/messages`, { body: text, internal: true, after: lastId.current }), 'Note added');
      if (r) { merge(r); setText(''); setNoteMode(false); }
      return;
    }
    const r = await run(() => api.post(`/live-chat/${id}/messages`, { body: text, after: lastId.current }));
    if (r) { merge(r); setText(''); typing.sent(); onChanged(); } // sending clears "typing…" on the server
  };
  const fill = (body) => fillTemplate(body, { visitorName: c.visitorName, profileName: c.profile?.name, agentName: user.name });
  const insert = (t) => {
    const filled = fill(t.body);
    const el = inputRef.current;
    let next;
    if (picker?.slash) next = filled; // replaces the "/search"
    else {
      const at = el ? el.selectionStart : text.length;
      const end = el ? el.selectionEnd : text.length;
      next = text.slice(0, at) + filled + text.slice(end);
    }
    setText(next);
    typing.typed(next);
    setPicker(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length); });
  };
  const onType = (value) => {
    setText(value);
    if (noting) return; // notes: no "typing…" for the visitor, no templates
    typing.typed(value);
    if (/^\/[^\n]*$/.test(value)) { setPicker({ query: value.slice(1), slash: true }); setPick(0); }
    else if (picker?.slash) setPicker(null);
  };
  const onKey = (e) => {
    if (picker?.slash) {
      const items = matchTemplates(templates || [], picker.query);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && items[pick]) { e.preventDefault(); insert(items[pick]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPicker(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) send(e);
  };
  const act = async (action, message) => {
    const r = await run(() => api.post(`/live-chat/${id}/${action}`, {}), message);
    if (r) { merge(r, true); onChanged(); }
  };

  return (
    <div className="card lc-thread">
      <div className="card-head">
        <div>
          <h2 style={{ margin: 0 }}>{c.visitorName} {c.status === 'Open' ? <Pill tone="green">Open</Pill> : <Pill tone="grey">Closed</Pill>}</h2>
          <small className="muted">{c.visitorOnline ? 'On the website now' : `Last message ${timeAgo(c.lastMessageAt)}`}</small>
        </div>
        {manage && (
          <div className="row">
            {c.assignedTo !== user.id && c.status === 'Open' && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('assign', 'Assigned to you')}>Assign to me</button>}
            {c.status === 'Open'
              ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('close', 'Chat closed')}>Close chat</button>
              : <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('reopen', 'Chat reopened')}>Reopen</button>}
          </div>
        )}
      </div>
      <div className="lc-thread-body">
        <div className="lc-messages chat-list" ref={listRef} aria-live="polite">
          {data.messages.map((m) => (m.sender === 'System' ? (
            <p key={m.id} className="lc-system">{m.body} · {dateTime(m.at)}</p>
          ) : (
            <div key={m.id} className={`chat-msg ${m.sender === 'Staff' ? 'companion' : ''}${m.internal ? ' lc-note-msg' : ''}`}>
              {m.profile && <SentCard p={m.profile} siteUrl={siteUrl} />}
              {m.body && <div className="chat-bubble">{m.internal && <b className="lc-note-tag">Internal note</b>}{m.body}</div>}
              <small>{m.sender === 'Staff' ? m.name : c.visitorName} · {dateTime(m.at)}{m.internal ? ' · only staff see this' : ''}</small>
            </div>
          )))}
          {visitorTyping && c.status === 'Open' && (
            <div className="chat-msg lc-typing">
              <div className="chat-bubble" aria-hidden="true"><i /><i /><i /></div>
              <small>{c.visitorName} is typing…</small>
            </div>
          )}
        </div>
        <aside className="lc-info">
          <KeyVals rows={[
            ['Reference', c.reference],
            ['Email', c.visitorEmail ? <a href={`mailto:${c.visitorEmail}`}>{c.visitorEmail}</a> : '—'],
            ['Asking about', c.profile ? <><Link to={`/profiles/${c.profile.id}`}>{c.profile.name}</Link>{siteUrl && <> · <a href={`${siteUrl.replace(/\/$/, '')}/companions/${c.profile.slug}`} target="_blank" rel="noreferrer">on the website ↗</a></>}</> : '—'],
            ['Started on', c.pageUrl || '—'],
            ['Started', dateTime(c.createdAt)],
            ['Handled by', c.assignedName || '—'],
            ['Rating', c.rating ? <>{RATING[c.rating]}{c.ratingComment && <q className="lc-rating-comment">{c.ratingComment}</q>}</> : c.status === 'Closed' ? 'Not rated' : '—'],
            ['Transcript', c.transcriptSentAt ? `Emailed to the visitor ${dateTime(c.transcriptSentAt)}` : '—'],
          ]} />
        </aside>
      </div>
      {manage && (
        <form className={`lc-compose${noting ? ' is-note' : ''}`} onSubmit={send}>
          {c.status === 'Open' && (
            <div className="lc-compose-mode" role="tablist" aria-label="Write">
              <button type="button" role="tab" aria-selected={!noteMode} className={!noteMode ? 'on' : ''} onClick={() => setNoteMode(false)}>Reply</button>
              <button type="button" role="tab" aria-selected={noteMode} className={noteMode ? 'on' : ''}
                onClick={() => { setNoteMode(true); setPicker(null); typing.stop(); }}>Internal note</button>
            </div>
          )}
          {picker && !noting && (
            <TemplatePicker templates={templates} query={picker.query} onQuery={(query) => setPicker({ query, slash: false })} search={!picker.slash}
              active={pick} onActive={setPick} fill={fill} onPick={insert} onClose={closePicker}
              onManage={() => { setPicker(null); onManageTemplates(); }} />
          )}
          <textarea ref={inputRef} rows={2} maxLength={2000} value={text}
            placeholder={noting ? `Note for staff only — ${c.visitorName} won’t see it (Enter to save)` : `Reply to ${c.visitorName}… (Enter to send, Shift+Enter for a new line, / for templates)`}
            aria-label={noting ? 'Internal note' : 'Reply'}
            onChange={(e) => onType(e.target.value)} onBlur={typing.stop} onKeyDown={onKey}
            aria-expanded={!!picker} aria-haspopup="listbox" />
          <div className="lc-compose-actions">
            {!noting && <>
              <button type="button" className={`btn btn-ghost tpl-toggle${picker && !picker.slash ? ' on' : ''}`} aria-expanded={!!picker && !picker.slash}
                onClick={() => { setPicker((p) => (p && !p.slash ? null : { query: '', slash: false })); setPick(0); }}>Templates</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setPicker(null); setSharing(true); }} title="Send a profile card with View profile and Book buttons">Profile</button>
            </>}
            <button className="btn btn-primary" disabled={!text.trim() || busy}>{noting ? 'Add note' : 'Send'}</button>
          </div>
        </form>
      )}
      {sharing && (
        <SendProfileModal chat={c} note={text} after={lastId.current} onClose={() => setSharing(false)}
          onSent={(r) => { merge(r); setText(''); typing.sent(); setSharing(false); onChanged(); }} />
      )}
      {manage && c.status === 'Closed' && <p className="muted lc-closed-note">This chat is closed. You can add internal notes; reopen it to reply (the visitor sees it in the same browser).</p>}
    </div>
  );
}

export default function LiveChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { meta } = useUi();
  const manage = can('inquiries', 'manage');
  const [q, setQ] = useQueryState({ status: 'Open', search: '', mine: '' });
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [feedTick, setFeedTick] = useState(0);
  const tpl = useLoad(() => (manage ? api.get('/live-chat/templates') : Promise.resolve([])), [manage]);
  const [managing, setManaging] = useState(false);
  const typingIds = useTypingChats();

  const load = useCallback(() => api.get('/live-chat', q).then((r) => { setList(r); setError(''); }).catch((e) => setError(e.message)), [q.status, q.search, q.mine]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useChatFeed(() => { load(); setFeedTick((n) => n + 1); });

  // on a wide screen, open the first conversation straight away
  const items = list?.items || [];
  useEffect(() => {
    if (!id && items.length && window.matchMedia('(min-width: 1101px)').matches) navigate(`/live-chat/${items[0].id}?${new URLSearchParams(window.location.search)}`, { replace: true });
  }, [id, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = list?.stats;
  const siteUrl = import.meta.env.VITE_WEBSITE_URL || meta?.websiteUrl;
  return (
    <>
      <PageHead title="Live chat" subtitle="Chats from the website’s chat button. Messages are stored encrypted."
        actions={manage && <button className="btn btn-ghost" onClick={() => setManaging(true)}>Reply templates</button>} />
      <Tabs value={q.status} onChange={(status) => setQ({ status })} tabs={[['Open', 'Open', stats?.waiting || null], ['Closed', 'Closed'], ['all', 'All']]} />
      {error && <ErrorBox error={error} onRetry={load} />}
      {!list ? <Loading /> : (
        <div className={`lc-layout${id ? ' has-active' : ''}`}>
          <div className="card lc-list-card">
            <div className="filters">
              <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Name, email, reference…" />
              <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={q.mine === '1'} onChange={(e) => setQ({ mine: e.target.checked ? '1' : '' })} /> Mine</label>
            </div>
            <nav className="lc-rows" aria-label="Chats">
              {items.length ? items.map((c) => <ChatRow key={c.id} c={c} active={String(c.id) === id} typing={typingIds.includes(c.id)} />)
                : <Empty title={q.status === 'Open' ? 'No open chats' : 'No chats'} text={q.status === 'Open' ? 'Visitors start a chat with the button on the website.' : 'Nothing matches these filters.'} icon="💬" />}
            </nav>
          </div>
          <div className="lc-view">
            {id && <Link to={`/live-chat?${new URLSearchParams(window.location.search)}`} className="lc-back">← All chats</Link>}
            {id ? <Thread key={id} id={id} manage={manage} onChanged={load} feedTick={feedTick} siteUrl={siteUrl}
              templates={tpl.error ? [] : tpl.data} onManageTemplates={() => setManaging(true)} visitorTyping={typingIds.includes(Number(id))} />
              : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Choose a chat.{siteUrl && <> Visitors start one from <a href={siteUrl} target="_blank" rel="noreferrer">the website</a>.</>}</p></div>}
          </div>
        </div>
      )}
      {managing && <TemplatesModal templates={tpl.data} onChange={(r) => tpl.setData(r)} onClose={() => setManaging(false)} />}
    </>
  );
}
