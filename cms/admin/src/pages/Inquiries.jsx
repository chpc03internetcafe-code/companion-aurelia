import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { useLiveRefresh } from '../lib/notifications';
import { dateTime } from '../lib/format';
import { Empty, ErrorBox, Field, KeyVals, Loading, Modal, PageHead, Pager, Pill, SearchBox, Stats, useAction, useLoad, useQueryState } from '../components/kit';

function InquiryModal({ inquiry, onClose, onSaved }) {
  const { meta } = useUi();
  const { can } = useAuth();
  const manage = can('inquiries', 'manage');
  const [notes, setNotes] = useState(inquiry.staffNotes || '');
  const [run, busy] = useAction();
  const update = async (body, msg) => { const r = await run(() => api.patch(`/inquiries/${inquiry.id}`, body), msg); if (r) onSaved(r); };
  useEffect(() => { if (manage && inquiry.status === 'New') update({ status: 'In Progress' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mailto = `mailto:${inquiry.email}?subject=${encodeURIComponent(`Re: ${inquiry.subject} (${inquiry.reference})`)}&body=${encodeURIComponent(`Hi ${inquiry.fullName.split(' ')[0]},\n\n`)}`;
  return (
    <Modal title={`${inquiry.subject} — ${inquiry.reference}`} onClose={onClose} size="wide">
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(220px, 2fr)' }}>
        <div className="stack">
          <blockquote style={{ margin: 0, padding: '12px 16px', background: 'var(--bg)', borderLeft: '3px solid var(--primary)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{inquiry.message}</blockquote>
          <div className="row">
            <a className="btn btn-primary btn-sm" href={mailto}>Reply by email</a>
            {inquiry.phone && <a className="btn btn-ghost btn-sm" href={`tel:${inquiry.phone.replace(/\s/g, '')}`}>Call {inquiry.phone}</a>}
          </div>
          <Field label="Staff notes (internal)"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!manage} /></Field>
          {manage && <div><button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => update({ staffNotes: notes }, 'Notes saved')}>Save notes</button></div>}
        </div>
        <div className="stack">
          <KeyVals rows={[
            ['From', inquiry.fullName], ['Email', inquiry.email], ['Phone', inquiry.phone], ['Received', dateTime(inquiry.createdAt)],
          ]} />
          <Field label="Status">
            <select value={inquiry.status} disabled={!manage || busy} onChange={(e) => update({ status: e.target.value }, 'Status updated')}>{meta.inquiryStatuses.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export default function Inquiries() {
  const { meta } = useUi();
  const [q, setQ] = useQueryState({ status: 'Open', subject: '', search: '', page: 1, pageSize: 25 });
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/inquiries', q), [JSON.stringify(q)]);
  const stats = useLoad(() => api.get('/inquiries/stats'), []);
  useLiveRefresh('inquiries', () => { reload(true); stats.reload(true); });
  const [open, setOpen] = useState(null);
  const s = stats.data;
  return (
    <>
      <PageHead title="Messages" subtitle="Messages from the website contact form. Questions about a specific profile are under Bookings → Inquiries." />
      {s && <Stats items={[
        { label: 'New', value: s.new, tone: s.new ? 'warn' : '', onClick: () => setQ({ status: 'New' }), active: q.status === 'New' },
        { label: 'In progress', value: s.inProgress, onClick: () => setQ({ status: 'In Progress' }), active: q.status === 'In Progress' },
        { label: 'Resolved (30 days)', value: s.resolved30d, onClick: () => setQ({ status: 'Resolved' }), active: q.status === 'Resolved' },
        { label: 'All time', value: s.total, onClick: () => setQ({ status: '' }), active: !q.status },
      ]} />}
      <div className="card">
        <div className="filters">
          <SearchBox value={q.search} onChange={(search) => setQ({ search })} placeholder="Name, email, reference, message…" />
          <select value={q.status} onChange={(e) => setQ({ status: e.target.value })} aria-label="Status"><option value="">All</option><option value="Open">Open</option>{meta.inquiryStatuses.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={q.subject} onChange={(e) => setQ({ subject: e.target.value })} aria-label="Subject"><option value="">All subjects</option>{meta.inquirySubjects.map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length ? (
          <table className="table">
            <thead><tr><th>From</th><th>Subject</th><th className="hide-sm">Message</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => setOpen(i)}>
                <td><strong>{i.fullName}</strong><span className="sub">{i.email}</span></td>
                <td>{i.subject}</td>
                <td className="hide-sm" style={{ maxWidth: 360 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.message}</span></td>
                <td className="nowrap">{dateTime(i.createdAt)}<span className="sub">{i.reference}</span></td>
                <td><Pill>{i.status}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty icon="✉" title="No messages" text="Nothing matches these filters." />}
        {data && <Pager page={q.page} pageSize={q.pageSize} total={data.total} onChange={setQ} />}
      </div>
      {open && <InquiryModal inquiry={open} onClose={() => { setOpen(null); reload(true); stats.reload(true); }}
        onSaved={(r) => { setOpen(r); setData((d) => ({ ...d, items: d.items.map((x) => (x.id === r.id ? r : x)) })); }} />}
    </>
  );
}
