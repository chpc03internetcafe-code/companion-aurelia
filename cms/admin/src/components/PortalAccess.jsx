// Profile editor → Portal access: invite the companion to the companion portal and manage their sign-in.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { dateTime } from '../lib/format';
import { Field, KeyVals, Loading, Pill, useAction, useLoad } from './kit';

export default function PortalAccess({ p, manage }) {
  const { confirm, prompt, toast } = useUi();
  const { data, loading, setData } = useLoad(() => api.get(`/companions/profile/${p.id}`), [p.id]);
  const changes = useLoad(() => api.get('/companions/changes', { status: 'Pending', profileId: p.id }), [p.id]);
  const [email, setEmail] = useState('');
  const [run, busy] = useAction();
  if (loading && !data) return <Loading />;
  const a = data.account;

  const showLink = (r, what) => {
    if (r.sent) toast(`${what} emailed`);
    else if (r.link) prompt({ title: 'Email is not set up', message: 'Copy this link and send it to the companion securely:', defaultValue: r.link, confirmLabel: 'Done' });
    else toast('Email is not set up', 'error');
  };
  const invite = async (to) => {
    const r = await run(() => api.post(`/companions/profile/${p.id}/invite`, { email: to }));
    if (r) { setData({ account: r.account }); showLink(r, 'Invitation'); setEmail(''); }
  };
  const act = async (path, body, message, ask) => {
    if (ask && !(await confirm(ask))) return;
    const r = await run(() => api.post(`/companions/${a.id}/${path}`, body), message);
    if (r?.account) setData({ account: r.account });
    return r;
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remove portal access?', message: 'They’re signed out and can no longer sign in. You can invite them again later.', danger: true, confirmLabel: 'Remove' }))) return;
    if (await run(() => api.del(`/companions/${a.id}`), 'Portal access removed')) setData({ account: null });
  };
  const pending = changes.data?.items.length || 0;

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>Companion portal</div>
        <p className="muted">The companion can sign in at <code>/companion</code> to accept or decline booking requests, set their hours and time off, and send wording or photo updates for you to approve. They never see client emails or phone numbers.</p>
        {!a ? (
          manage ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); invite(email); }}>
              <Field label="Companion’s email" hint="We’ll email a link to choose a password (valid 72 hours)."><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <div><button className="btn btn-primary" disabled={busy || p.status === 'Retired'}>Send invitation</button></div>
            </form>
          ) : <p>No portal access yet.</p>
        ) : (
          <>
            <KeyVals rows={[
              ['Status', <Pill key="s" tone={{ Active: 'green', Invited: 'amber', Suspended: 'grey' }[a.status]}>{a.status === 'Suspended' ? 'Paused' : a.status}</Pill>],
              ['Email', a.email],
              ['Invited', a.invitedAt ? `${dateTime(a.invitedAt)}${a.invitedBy ? ` by ${a.invitedBy}` : ''}` : null],
              ['Activated', a.activatedAt ? dateTime(a.activatedAt) : null],
              ['Last sign-in', a.lastLoginAt ? dateTime(a.lastLoginAt) : a.status === 'Active' ? 'Not yet' : null],
              ['Two-step sign-in', a.status === 'Invited' ? null : a.twoStepSince ? `On since ${dateTime(a.twoStepSince)}` : 'Off'],
              ['Signed-in devices', a.status === 'Active' ? a.devices : null],
            ]} />
            {manage && (
              <div className="row" style={{ marginTop: 14 }}>
                {a.status === 'Invited' && <button className="btn btn-primary" disabled={busy} onClick={async () => { const to = await prompt({ title: 'Resend invitation', label: 'Email', defaultValue: a.email, required: true, confirmLabel: 'Send' }); if (to) invite(to); }}>Resend invitation</button>}
                {a.status === 'Active' && <button className="btn btn-ghost" disabled={busy} onClick={async () => { const r = await act('password-link', {}); if (r) showLink(r, 'Password link'); }}>Send password link</button>}
                {a.status === 'Active' && a.devices > 0 && <button className="btn btn-ghost" disabled={busy} onClick={() => act('sessions', {}, 'Signed out everywhere', { title: 'Sign out all devices?', confirmLabel: 'Sign out' })}>Sign out devices</button>}
                {a.twoStepSince && <button className="btn btn-ghost" disabled={busy} onClick={() => act('two-step/reset', {}, 'Two-step sign-in turned off', { title: 'Reset two-step sign-in?', message: 'Only after confirming who you’re talking to. They’re signed out everywhere and can sign in with just their password.', danger: true, confirmLabel: 'Reset two-step' })}>Reset two-step</button>}
                {a.status === 'Active' && <button className="btn btn-danger-ghost" disabled={busy} onClick={() => act('status', { status: 'Suspended' }, 'Portal access paused', { title: 'Pause portal access?', message: 'They’re signed out and can’t sign in until you reactivate it.', confirmLabel: 'Pause' })}>Pause access</button>}
                {a.status === 'Suspended' && <button className="btn btn-primary" disabled={busy} onClick={() => act('status', { status: 'Active' }, 'Portal access reactivated')}>Reactivate</button>}
                <button className="btn btn-danger-ghost" disabled={busy} onClick={remove}>Remove access</button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>Updates waiting for review</div>
        {changes.loading && !changes.data ? <Loading /> : pending
          ? <p>{pending} update{pending === 1 ? '' : 's'} from this companion. <Link to="/profile-updates">Review them →</Link></p>
          : <p className="muted">Nothing waiting.</p>}
      </div>
    </div>
  );
}
