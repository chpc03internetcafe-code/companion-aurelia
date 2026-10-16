// Adults-only notice shown on the first visit (turned on/off and worded in Site Settings).
import { useEffect } from 'react';
import { useSite } from '../context/SiteContext';
import { Logo } from './Header';

export default function AgeGate() {
  const { site, ageOk, confirmAge } = useSite();
  const show = site.ageGateEnabled === '1' && !ageOk;
  useEffect(() => {
    document.body.style.overflow = show ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [show]);
  if (!show) return null;
  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="age-card">
        <Logo />
        <span className="adult-badge" style={{ width: 54, height: 54, fontSize: '1rem', marginBottom: 14 }}>18+</span>
        <h2 id="age-title">Adults only</h2>
        <p>{site.ageGateText}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button className="btn btn-primary btn-lg" onClick={confirmAge} autoFocus>I am 18 or older — enter</button>
          <a className="btn btn-ghost btn-lg" href="https://www.google.com" rel="noreferrer">Leave</a>
        </div>
      </div>
    </div>
  );
}
