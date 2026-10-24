import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { initials } from '../utils/format';
import { IconChevron } from './Icons';

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function Toasts() {
  const { toasts } = useSite();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
    </div>
  );
}

export function Field({ label, error, hint, children, className = '', required }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req" aria-hidden="true"> *</span>}</span>}
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

export function SectionHead({ kicker, title, text, action, center }) {
  return (
    <div className={`section-head ${center ? 'center' : ''}`}>
      <div>
        {kicker && <span className="kicker">{kicker}</span>}
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      {action}
    </div>
  );
}

export function Crumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map(([label, to], i) => (
        <span key={label} className="row" style={{ gap: 8 }}>
          {i > 0 && <IconChevron size={12} />}
          {to && i < items.length - 1 ? <Link to={to}>{label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHero({ kicker, title, text, crumbs, children, compact }) {
  return (
    <section className={`page-hero ${compact ? 'compact' : ''}`}>
      <div className="container">
        {crumbs && <Crumbs items={crumbs} />}
        {kicker && <span className="kicker">{kicker}</span>}
        <h1>{title}</h1>
        {text && <p className="lead">{text}</p>}
        {children}
      </div>
    </section>
  );
}

export function Loading({ text = 'Loading…' }) {
  return <div className="loading"><span className="spinner" aria-hidden="true" />{text}</div>;
}

// ---------- Loading skeletons: grey placeholders shaped like the content that's on its way ----------
const Bone = ({ w, h, r, style }) => <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;

/** Placeholder profile cards for a grid that's loading. */
export function CardsSkeleton({ count = 8, className = 'grid-cards' }) {
  return (
    <div className={className} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="p-card skel-card" aria-hidden="true">
          <div className="p-card-media skel" />
          <div className="p-card-body"><Bone w="85%" h={12} /><Bone w="55%" h={12} style={{ marginTop: 10 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder article cards (guides, news). */
export function PostsSkeleton({ count = 3 }) {
  return (
    <div className="grid-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="post-card" aria-hidden="true">
          <div className="post-cover skel" />
          <div className="post-card-body"><Bone w="40%" h={10} /><Bone w="90%" h={18} style={{ marginTop: 10 }} /><Bone w="100%" h={12} style={{ marginTop: 10 }} /><Bone w="70%" h={12} style={{ marginTop: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a whole page: heading, intro and a few paragraphs (or a photo + text for profiles). */
export function PageSkeleton({ media = false }) {
  return (
    <section className="section" role="status" aria-label="Loading">
      <div className={`container ${media ? 'skel-split' : 'narrow'}`} aria-hidden="true">
        {media && <div className="gallery-main skel" />}
        <div>
          <Bone w={120} h={12} />
          <Bone w="70%" h={40} r={10} style={{ marginTop: 16 }} />
          <Bone w="90%" h={14} style={{ marginTop: 22 }} />
          <Bone w="80%" h={14} style={{ marginTop: 10 }} />
          <Bone w="85%" h={14} style={{ marginTop: 10 }} />
          <Bone w="60%" h={14} style={{ marginTop: 10 }} />
        </div>
      </div>
    </section>
  );
}

/** value, delayed until it has stopped changing for ms (search-as-you-type without a request per keystroke). */
export function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Empty({ title, text, action }) {
  return <div className="empty"><strong>{title}</strong>{text && <p>{text}</p>}{action}</div>;
}

export function Status({ value }) {
  return <span className={`status status-${value}`}>{value}</span>;
}

// Images load lazily (only when scrolled near) unless priority is set for the main above-the-fold picture.
export function Photo({ src, alt, name, className = '', priority = false }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img className={className} src={src} alt={alt || name || ''} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchpriority={priority ? 'high' : undefined}
      onError={() => setBroken(true)} />
    : <span className={`photo-missing ${className}`} aria-hidden="true">{initials(name || '?')}</span>;
}

/** Renders CMS content sections (text, list, table, stats, callout). */
export function Sections({ sections = [] }) {
  return (
    <div className="prose">
      {sections.map((s, i) => (
        <section key={i}>
          {s.heading && s.type !== 'callout' && <h2>{s.heading}</h2>}
          {s.type === 'text' && s.body.split(/\n{2,}/).map((p, k) => <p key={k} style={{ whiteSpace: 'pre-line' }}>{p}</p>)}
          {s.type === 'list' && <ul>{s.items.filter((x) => String(x).trim()).map((x, k) => <li key={k}>{x}</li>)}</ul>}
          {s.type === 'callout' && <div className="callout">{s.heading && <h3 style={{ marginTop: 0 }}>{s.heading}</h3>}<p style={{ margin: 0, whiteSpace: 'pre-line' }}>{s.body}</p></div>}
          {s.type === 'stats' && <div className="stat-row">{s.items.map((x, k) => <div key={k}><strong>{x.value}</strong><span>{x.label}</span></div>)}</div>}
          {s.type === 'table' && (
            <div className="table-wrap"><table><thead><tr>{s.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
              <tbody>{s.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
          )}
        </section>
      ))}
    </div>
  );
}

export function FaqList({ faqs }) {
  const [open, setOpen] = useState(null);
  return (
    <div>
      {faqs.map((f) => (
        <div key={f.id} className={`faq-item ${open === f.id ? 'open' : ''}`}>
          <button onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}><span>{f.question}</span><span aria-hidden="true">+</span></button>
          {open === f.id && <div style={{ whiteSpace: 'pre-line' }}>{f.answer}</div>}
        </div>
      ))}
    </div>
  );
}

/** Closes a popover when clicking outside it. */
export function useOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const on = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [onOutside]);
  return ref;
}
