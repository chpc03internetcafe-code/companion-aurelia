import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveRefresh } from '../lib/notifications';
import { day, dateTime, money, time12, todayIso } from '../lib/format';
import { Bars, Empty, ErrorBox, Loading, PageHead, Pill, Stats, Thumb, useLoad } from '../components/kit';

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data: d, loading, error, reload } = useLoad(() => api.get('/dashboard'), []);
  useLiveRefresh(['bookings', 'inquiries'], () => reload(true));
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const b = d.bookings;
  const hour = new Date(Date.now() + 8 * 3600000).getUTCHours();
  return (
    <>
      <PageHead title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`} subtitle={new Date(`${todayIso()}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} />
      <Stats items={[
        b && { label: 'Requests to confirm', value: b.pending, tone: b.pending ? 'warn' : '', to: '/bookings?kind=Booking&status=Pending&sort=newest' },
        b && { label: 'Inquiries to answer', value: b.inquiries, tone: b.inquiries ? 'warn' : '', to: '/bookings?kind=Inquiry&status=Pending&sort=newest' },
        b && { label: 'Confirmed today', value: b.today, to: `/bookings?status=Confirmed&from=${todayIso()}&to=${todayIso()}` },
        b && { label: 'Confirmed next 7 days', value: b.next7 },
        d.liveChat && { label: 'Live chats waiting', value: d.liveChat.waiting, tone: d.liveChat.waiting ? 'warn' : '', to: '/live-chat' },
        d.inquiries && { label: 'New messages', value: d.inquiries.new, tone: d.inquiries.new ? 'warn' : '', to: '/inquiries?status=New' },
      ]} />
      <div className="split">
        <div className="stack">
          {b && (
            <div className="card">
              <div className="card-head"><h2>Today</h2><Link to={`/bookings?from=${todayIso()}&to=${todayIso()}&status=`}>All today →</Link></div>
              {d.today.length ? (
                <table className="table">
                  <tbody>{d.today.map((x) => (
                    <tr key={x.id} className="clickable" onClick={() => navigate(`/bookings/${x.id}`)}>
                      <td className="nowrap"><strong>{time12(x.startTime)}</strong><span className="sub">until {time12(x.endTime)}</span></td>
                      <td><div className="row" style={{ flexWrap: 'nowrap' }}><Thumb src={x.profilePhoto} name={x.profileName} w={30} h={38} /><div><strong>{x.profileName}</strong><span className="sub">{x.rateLabel}</span></div></div></td>
                      <td>{x.clientName}<span className="sub">{x.locationName || ''}{x.meetingPlace ? ` · ${x.meetingPlace}` : ''}</span></td>
                      <td><Pill>{x.status}</Pill></td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <div className="card-body"><Empty icon="☾" title="Nothing booked today" /></div>}
            </div>
          )}
          {b && (
            <div className="card">
              <div className="card-head"><h2>Waiting for a reply</h2><Link to="/bookings?status=Pending&sort=newest">All pending →</Link></div>
              {d.queue.length ? (
                <table className="table">
                  <tbody>{d.queue.map((x) => (
                    <tr key={x.id} className="clickable" onClick={() => navigate(`/bookings/${x.id}`)}>
                      <td><Pill>{x.kind}</Pill><span className="sub">{x.reference}</span></td>
                      <td><strong>{x.profileName}</strong><span className="sub">{x.bookingDate ? `${day(x.bookingDate)}${x.startTime ? ` ${time12(x.startTime)}` : ''}` : 'No date'}</span></td>
                      <td>{x.clientName}<span className="sub">received {dateTime(x.createdAt)}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <div className="card-body"><Empty icon="✓" title="All caught up" text="No requests waiting." /></div>}
            </div>
          )}
          {b && d.byDay && (
            <div className="card card-pad">
              <h2 style={{ marginBottom: 12 }}>Booking requests, last 14 days</h2>
              <Bars rows={d.byDay} value={(r) => r.n} label={(r) => day(r.day, { month: 'short', day: 'numeric' })} />
            </div>
          )}
        </div>
        <div className="stack">
          {b && (
            <div className="card card-pad">
              <h2 style={{ marginBottom: 10 }}>Last 30 days</h2>
              <div className="kv-line"><span>Booking requests</span><strong>{b.requests30}</strong></div>
              <div className="kv-line"><span>Completed</span><strong>{b.completed30}</strong></div>
              <div className="kv-line"><span>Value of completed bookings</span><strong>{money(b.value30, true)}</strong></div>
              <div className="kv-line"><span>Cancelled / declined / no-show</span><strong>{b.lost30}</strong></div>
              {d.topProfiles.length > 0 && <>
                <div className="section-title">Most requested</div>
                <Bars rows={d.topProfiles} value={(r) => r.n} label={(r) => r.displayName} />
              </>}
            </div>
          )}
          {d.profiles && (
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2>Profiles</h2>{can('profiles') && <Link to="/profiles">Manage →</Link>}</div>
              <div className="kv-line"><span>Published</span><strong>{d.profiles.published}</strong></div>
              <div className="kv-line"><span>Drafts</span><strong>{d.profiles.drafts}</strong></div>
              <div className="kv-line"><Link to="/profiles?flag=unverified">Published, not verified</Link><strong>{d.profiles.unverified}</strong></div>
              <div className="kv-line"><span>No availability set</span><strong>{d.profiles.noAvailability}</strong></div>
              <div className="kv-line"><Link to="/profiles?sort=updated">Not updated in 30 days</Link><strong>{d.profiles.stale}</strong></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
