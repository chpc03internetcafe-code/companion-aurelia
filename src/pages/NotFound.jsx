// Before showing "not found", ask the API whether this old URL has a redirect (managed in the CMS under SEO).
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, qs } from '../utils/api';
import { useSeo } from '../utils/seo';
import { Loading } from '../components/Common';

export default function NotFound() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  useSeo({ title: 'Page not found', noindex: true });
  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    api('GET', `/site/resolve${qs({ path: pathname })}`).then((r) => {
      if (cancelled) return;
      if (r.to) {
        if (/^https?:\/\//.test(r.to)) window.location.replace(r.to);
        else navigate(`${r.to}${r.to.includes('?') ? '' : search}`, { replace: true });
      } else setChecked(true);
    }).catch(() => !cancelled && setChecked(true));
    return () => { cancelled = true; };
  }, [pathname, search, navigate]);
  if (!checked) return <Loading />;
  return (
    <section className="section">
      <div className="narrow center">
        <span className="kicker">404</span>
        <h1>This page isn’t here</h1>
        <p className="lead" style={{ margin: '0 auto 26px' }}>The link may be old, or the profile may no longer be listed.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/companions" className="btn btn-primary">Browse companions</Link>
          <Link to="/" className="btn btn-ghost">Home</Link>
        </div>
      </div>
    </section>
  );
}
