import { useState } from 'react';
import { api, qs } from '../lib/api';
import { dateTime } from '../lib/format';
import { Empty, ErrorBox, KeyVals, Loading, Modal, PageHead, Pager, Pill, SearchBox, Stats, useLoad, useQueryState } from '../components/kit';

const fmt = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function EntryModal({ id, onClose }) {
  const { data, loading } = useLoad(() => api.get(`/audit/${id}`), [id]);
  return (
    <Modal title="Audit entry" onClose={onClose} size="wide">
      {loading || !data ? <Loading /> : (
        <div className="stack">
          <KeyVals rows={[['When', dateTime(data.createdAt)], ['Who', `${data.userName || data.actorType}${data.userEmail ? ` (${data.userEmail})` : ''}`], ['Actor', data.actorType],
            ['Action', data.action], ['Section', data.moduleLabel], ['Record', [data.entityType, data.entityLabel || data.entityId].filter(Boolean).join(' · ')], ['Summary', data.summary],
            ['IP address', data.ipAddress], ['Browser', data.userAgent]]} />
          {data.changes && (
            data.changes.values ? (
              <table className="table compact"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>{Object.entries(data.changes.values).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ overflowWrap: 'anywhere' }}>{fmt(v)}</td></tr>)}</tbody></table>
            ) : (
              <table className="table compact"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
                {Object.entries(data.changes).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ overflowWrap: 'anywhere', color: 'var(--danger)' }}>{fmt(v?.from)}</td><td style={{ overflowWrap: 'anywhere', color: 'var(--green)' }}>{fmt(v?.to ?? v)}</td></tr>)}
              </tbody></table>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

export default function AuditTrail() {
  const [q, setQ] = useQueryState({ search: '', module: '', action: '', userId: '', actorType: '', from: '', to: '', page: 1, pageSize: 50 });
  const filters = { search: q.search, module: q.module, action: q.action, userId: q.userId, actorType: q.actorType, from: q.from, to: q.to };
  const { data, loading, error, reload } = useLoad(() => api.get('/audit', { ...filters, page: q.page, pageSize: q.pageSize }), [JSON.stringify(filters), q.page, q.pageSize]);
  const opts = useLoad(() => api.get('/audit/filters'), []);
  const [open, setOpen] = useState(null);
  const o = opts.data;
  return (
    <>
      <PageHead title="Audit Trail" subtitle="Who did what and when — every change in the CMS, staff sign-ins, and website events (bookings, contact messages, live chats). Read-only."
        actions={<a className="btn btn-ghost" href={`/api/audit/export${qs(filters)}`}>Export CSV</a>} />
      {o && <Stats items={[
        { label: 'Entries', value: o.stats.total.toLocaleString() },
        { label: 'Last 24 hours', value: o.stats.last24h },
        { label: 'Active staff (7 days)', value: o.stats.activeStaff7d },
        { label: 'Failed sign-ins (7 days)', value: o.stats.failedSignIns7d, tone: o.stats.failedSignIns7d ? 'warn' : '', onClick: () => setQ({ action: 'Sign-in failed' }) },
      ]} />}
      <div className="card">
        <div className="filters">
          <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Summary, record, person…" />
          <select value={q.module} onChange={(e) => setQ({ module: e.target.value })} aria-label="Section"><option value="">All sections</option>{o?.modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          <select value={q.action} onChange={(e) => setQ({ action: e.target.value })} aria-label="Action"><option value="">All actions</option>{o?.actions.map((a) => <option key={a}>{a}</option>)}</select>
          <select value={q.userId} onChange={(e) => setQ({ userId: e.target.value })} aria-label="Staff"><option value="">Anyone</option>{o?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select value={q.actorType} onChange={(e) => setQ({ actorType: e.target.value })} aria-label="Actor"><option value="">Staff, members, companions, visitors & system</option><option>Staff</option><option>Member</option><option>Companion</option><option>Visitor</option><option>System</option></select>
          <input type="date" value={q.from} onChange={(e) => setQ({ from: e.target.value })} aria-label="From" />
          <input type="date" value={q.to} onChange={(e) => setQ({ to: e.target.value })} aria-label="To" />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th></tr></thead>
              <tbody>{data.items.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setOpen(e.id)}>
                  <td className="nowrap">{dateTime(e.createdAt)}</td>
                  <td>{e.userName || <span className="muted">{e.actorType}</span>}<span className="sub">{e.actorType !== 'Staff' ? e.actorType : e.userEmail}</span></td>
                  <td><Pill tone={/fail|blocked|delete|void|reject/i.test(e.action) ? 'red' : /creat|book|paid/i.test(e.action) ? 'green' : 'grey'}>{e.action}</Pill></td>
                  <td>{e.summary}{e.hasChanges && <span className="sub">View changes →</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="☰" title="No entries" text="Nothing matches these filters." />}
        {data && <Pager page={q.page} pageSize={q.pageSize} total={data.total} onChange={setQ} />}
      </div>
      {open && <EntryModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
