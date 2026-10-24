// Live chat with website visitors: conversations on the left, the open one on the right.
// New messages arrive by long polling /live-chat/wait, so replies appear within a second or two.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime } from '../lib/format';
import { timeAgo } from '../lib/notifications';
import { Empty, ErrorBox, KeyVals, Loading, PageHead, Pill, SearchBox, Tabs, useAction, useQueryState } from '../components/kit';

const RETRY_MS = 5000;

/** Calls onChange() whenever a live chat message arrives anywhere (long poll), while the tab is visible. */
function useChatFeed(onChange) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    let stopped = false;
    let after = 0;
    let wake = () => {};
    const pause = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });
    const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    (async () => {
      while (!stopped) {
        if (document.visibilityState !== 'visible') { await pause(60_000); continue; }
        try {
          const r = await api.get('/live-chat/wait', { after });
          if (stopped) break;
          if (after && r.latestId > after) ref.current();
          after = r.latestId;
        } catch {
          await pause(RETRY_MS);
        }
      }
    })();
    return () => { stopped = true; wake(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
}

function ChatRow({ c, active }) {
  return (
    <Link to={`/live-chat/${c.id}`} className={`lc-row${active ? ' on' : ''}${c.unread ? ' unread' : ''}`} aria-current={active ? 'true' : undefined}>
      <span className="lc-row-head">
        <strong>{c.visitorOnline && <i className="lc-online" title="On the website now" />}{c.visitorName}</strong>
        {c.unread > 0 ? <span className="pill pill-red">{c.unread} new</span> : <small className="muted">{timeAgo(c.lastMessageAt)}</small>}
      </span>
      <span className="lc-row-preview">{c.lastSender === 'Staff' ? 'You: ' : ''}{c.preview}</span>
      <small className="muted">{c.reference}{c.assignedName ? ` · ${c.assignedName}` : ''}{c.status === 'Closed' ? ' · closed' : ''}</small>
    </Link>
  );
}

function Thread({ id, manage, onChanged, feedTick }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const lastId = useRef(0);

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
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [data?.messages.length]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading rows={4} />;
  const c = data.chat;

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    const r = await run(() => api.post(`/live-chat/${id}/messages`, { body: text, after: lastId.current }));
    if (r) { merge(r); setText(''); onChanged(); }
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
            <div key={m.id} className={`chat-msg ${m.sender === 'Staff' ? 'companion' : ''}`}>
              <div className="chat-bubble">{m.body}</div>
              <small>{m.sender === 'Staff' ? m.name : c.visitorName} · {dateTime(m.at)}</small>
            </div>
          )))}
        </div>
        <aside className="lc-info">
          <KeyVals rows={[
            ['Reference', c.reference],
            ['Email', c.visitorEmail ? <a href={`mailto:${c.visitorEmail}`}>{c.visitorEmail}</a> : '—'],
            ['Started on', c.pageUrl || '—'],
            ['Started', dateTime(c.createdAt)],
            ['Handled by', c.assignedName || '—'],
          ]} />
        </aside>
      </div>
      {manage && c.status === 'Open' && (
        <form className="lc-compose" onSubmit={send}>
          <textarea rows={2} maxLength={2000} placeholder={`Reply to ${c.visitorName}… (Enter to send, Shift+Enter for a new line)`} value={text} aria-label="Reply"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
          <button className="btn btn-primary" disabled={!text.trim() || busy}>Send</button>
        </form>
      )}
      {manage && c.status === 'Closed' && <p className="muted lc-closed-note">This chat is closed. Reopen it to reply; the visitor sees it in the same browser.</p>}
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
      <PageHead title="Live chat" subtitle="Chats from the website’s chat button. Messages are stored encrypted." />
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
              {items.length ? items.map((c) => <ChatRow key={c.id} c={c} active={String(c.id) === id} />)
                : <Empty title={q.status === 'Open' ? 'No open chats' : 'No chats'} text={q.status === 'Open' ? 'Visitors start a chat with the button on the website.' : 'Nothing matches these filters.'} icon="💬" />}
            </nav>
          </div>
          <div className="lc-view">
            {id && <Link to={`/live-chat?${new URLSearchParams(window.location.search)}`} className="lc-back">← All chats</Link>}
            {id ? <Thread key={id} id={id} manage={manage} onChanged={load} feedTick={feedTick} />
              : <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Choose a chat.{siteUrl && <> Visitors start one from <a href={siteUrl} target="_blank" rel="noreferrer">the website</a>.</>}</p></div>}
          </div>
        </div>
      )}
    </>
  );
}
