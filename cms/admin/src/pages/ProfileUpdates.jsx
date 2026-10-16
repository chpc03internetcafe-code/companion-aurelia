// Profile updates sent by companions from the portal: new wording (shown next to the current text) and new photos.
// Nothing reaches the website until it is approved here.
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUi } from '../lib/ui';
import { dateTime } from '../lib/format';
import { Empty, ErrorBox, Loading, PageHead, Pill, Tabs, useAction, useLoad, useQueryState } from '../components/kit';

const show = (v) => (v == null || v === '' ? <span className="muted">—</span> : String(v));

function DetailsDiff({ r, fields }) {
  return (
    <table className="table compact diff-table">
      <thead><tr><th>Field</th><th>Now on the profile</th><th>Proposed</th></tr></thead>
      <tbody>
        {fields.filter((f) => f.key in (r.data || {})).map((f) => (
          <tr key={f.key}>
            <td><strong>{f.label}</strong></td>
            <td className="diff-old">{r.current ? show(r.current[f.key]) : '—'}</td>
            <td className="diff-new">{show(r.data[f.key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProfileUpdates() {
  const { can } = useAuth();
  const { prompt, toast } = useUi();
  const manage = can('profiles', 'manage');
  const [q, setQ] = useQueryState({ status: 'Pending' });
  const { data, loading, error, reload } = useLoad(() => api.get('/companions/changes', { status: q.status }), [q.status]);
  const [run, busy] = useAction();

  const approve = async (r) => {
    const note = await prompt({ title: `Approve ${r.kind === 'photo' ? 'this photo' : 'this update'}?`, message: 'It goes live on the profile straight away.', label: 'Note to the companion (optional)', confirmLabel: 'Approve' });
    if (note === null) return;
    if (await run(() => api.post(`/companions/changes/${r.id}/approve`, { note }), 'Approved — the profile is updated')) reload(true);
  };
  const reject = async (r) => {
    const note = await prompt({ title: `Reject ${r.kind === 'photo' ? 'this photo' : 'this update'}?`, message: 'The companion is emailed this reason.', label: 'Reason', required: true, confirmLabel: 'Reject' });
    if (note === null) return;
    if (await run(() => api.post(`/companions/changes/${r.id}/reject`, { note }))) { toast('Rejected'); reload(true); }
  };

  return (
    <>
      <PageHead title="Profile updates" subtitle="Wording and photos companions sent from the portal. Approve them to publish." />
      <Tabs tabs={[['Pending', 'Waiting'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['Withdrawn', 'Withdrawn']]} value={q.status} onChange={(status) => setQ({ status })} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data.items.length ? (
        <Empty title={q.status === 'Pending' ? 'Nothing waiting' : `No ${q.status.toLowerCase()} updates`} text={q.status === 'Pending' ? 'Updates sent from the companion portal appear here.' : ''} icon="✓" />
      ) : (
        <div className="stack">
          {data.items.map((r) => (
            <div key={r.id} className="card">
              <div className="card-head">
                <h3><Link to={`/profiles/${r.profileId}`}>{r.displayName}</Link> · {r.kind === 'photo' ? 'New photo' : 'Profile wording'}</h3>
                <div className="row">
                  <span className="muted">{dateTime(r.createdAt)}</span>
                  {r.status !== 'Pending' && <Pill>{r.status}</Pill>}
                  {r.status === 'Pending' && manage && <>
                    <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => reject(r)}>Reject</button>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => approve(r)}>Approve</button>
                  </>}
                </div>
              </div>
              <div className="card-pad">
                {r.kind === 'photo'
                  ? (r.status === 'Rejected' || r.status === 'Withdrawn' ? <p className="muted">The photo file was removed.</p> : <a href={r.photoUrl} target="_blank" rel="noreferrer"><img src={r.photoUrl} alt="Proposed" className="review-photo" /></a>)
                  : <DetailsDiff r={r} fields={data.fields} />}
                {r.decidedAt && <p className="muted" style={{ margin: '10px 0 0' }}>{r.status} {dateTime(r.decidedAt)}{r.decidedBy ? ` by ${r.decidedBy}` : ''}{r.staffNote ? ` · “${r.staffNote}”` : ''}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
