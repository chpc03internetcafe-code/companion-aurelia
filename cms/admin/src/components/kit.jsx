// Shared admin building blocks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUi } from '../lib/ui';
import { money } from '../lib/format';

export function PageHead({ title, subtitle, back, actions, children }) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {back && <Link to={back[1]} className="back">← {back[0]}</Link>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, className = '', children, required }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="label">{label}{required && <b className="req" aria-hidden="true"> *</b>}</span>}
      {children}
      {error ? <small className="error">{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal modal-form ${size}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map(([v, label, count]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
          {count != null && count !== 0 && <span className="tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()}` : '0 results'}</span>
      <div className="pager-controls">
        <select value={pageSize} onChange={(e) => onChange({ page: 1, pageSize: Number(e.target.value) })} aria-label="Rows per page">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onChange({ page: page - 1 })}>‹ Prev</button>
        <span>Page {page} of {pages}</span>
        <button type="button" className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => onChange({ page: page + 1 })}>Next ›</button>
      </div>
    </div>
  );
}

const TONES = {
  // bookings
  Pending: 'amber', Confirmed: 'blue', Completed: 'green', Cancelled: 'grey', Declined: 'grey', 'No-Show': 'red', Answered: 'teal', Closed: 'grey',
  Booking: 'violet', Inquiry: 'teal',
  // profiles
  Published: 'green', Draft: 'grey', Hidden: 'amber', Retired: 'grey', Verified: 'green', Unverified: 'amber', Featured: 'violet', VIP: 'violet',
  // memberships
  Active: 'green', Expired: 'grey', Rejected: 'red', Suspended: 'red', New: 'teal', Renewal: 'blue', Upgrade: 'violet', Manual: 'grey',
  // generic
  Inactive: 'grey', Live: 'green', Visible: 'green', Disabled: 'grey', Public: 'grey', Members: 'violet', Resolved: 'green', 'In Progress': 'blue',
  Online: 'teal', Phone: 'grey', Messaging: 'grey', Staff: 'grey', Guide: 'blue', Announcement: 'amber', News: 'violet',
};
export function Pill({ children, tone, title }) {
  return <span className={`pill pill-${tone || TONES[children] || 'grey'}`} title={title}>{children}</span>;
}

export function Empty({ title, text, action, icon = '◇' }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// Loading skeleton: placeholder rows shaped like a list, shown while data loads.
const SKELETON_WIDTHS = ['72%', '58%', '84%', '64%', '76%', '52%', '68%', '80%'];
export function Loading({ text = 'Loading…', rows = 5 }) {
  return (
    <div className="skeleton" role="status" aria-label={text}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skel skel-thumb" />
          <span className="skel-lines"><span className="skel" style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }} /><span className="skel skel-sub" /></span>
          <span className="skel skel-pill" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner-error">
      <span>{error}</span>
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Stats({ items }) {
  return (
    <div className="stats">
      {items.filter(Boolean).map((s) => {
        const Tag = s.onClick ? 'button' : s.to ? Link : 'div';
        return (
          <Tag key={s.label} className={`stat ${s.active ? 'active' : ''}`} onClick={s.onClick} to={s.to} type={s.onClick ? 'button' : undefined}>
            <span>{s.label}</span>
            <strong className={s.tone || ''}>{s.value}</strong>
            {s.sub && <small>{s.sub}</small>}
          </Tag>
        );
      })}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  const [v, setV] = useState(value || '');
  const debounced = useDebounced(v, 300);
  const first = useRef(true);
  useEffect(() => { setV(value || ''); }, [value]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (debounced !== (value || '')) onChange(debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

/** Loads data from an async function; re-runs when deps change. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const counter = useRef(0);
  const run = useCallback((quiet = false) => {
    const n = ++counter.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: '' }));
    fn()
      .then((data) => n === counter.current && setState({ data, loading: false, error: '' }))
      .catch((e) => n === counter.current && setState((s) => ({ ...s, loading: false, error: e.message })));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Form state + server-side validation errors. */
export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const { toast } = useUi();
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };
  const submit = async (fn, successMessage) => {
    setSaving(true);
    setErrors({});
    try {
      const result = await fn(form);
      if (successMessage) toast(successMessage);
      return result;
    } catch (e) {
      setErrors(e.details || {});
      toast(e.message, 'error');
      return undefined;
    } finally {
      setSaving(false);
    }
  };
  return { form, setForm, set, errors, setErrors, saving, submit };
}

/** Runs an async action with a busy flag and toasts errors. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    try {
      const r = await fn();
      if (successMessage) toast(successMessage);
      return r ?? true;
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Pages a list that's already in the browser. Returns the rows for the current page and a <Pager />. resetKey (e.g. the search text) jumps back to page 1. */
export function usePaged(rows, { pageSize = 50, resetKey } = {}) {
  const [p, setP] = useState({ page: 1, pageSize });
  useEffect(() => { setP((s) => ({ ...s, page: 1 })); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / p.pageSize));
  const page = Math.min(p.page, pages);
  return {
    items: rows.slice((page - 1) * p.pageSize, page * p.pageSize),
    pager: rows.length > 25 ? <Pager page={page} pageSize={p.pageSize} total={rows.length} onChange={(x) => setP((s) => ({ ...s, ...x }))} /> : null,
  };
}

/** Filters kept in the URL (?status=…&page=2) so lists survive reloads and links. */
export function useQueryState(defaults) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => {
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v != null) out[k] = typeof defaults[k] === 'number' ? Number(v) : v;
    }
    return out;
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const resetPage = !('page' in patch) && 'page' in defaults;
      for (const [k, v] of Object.entries({ ...patch, ...(resetPage ? { page: 1 } : {}) })) {
        if (v === '' || v == null || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    }, { replace: true });
  }, [setParams]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, update];
}

/** Horizontal bars: one row per item, scaled to the largest value. */
export function Bars({ rows, value, label, format = (v) => v, title }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div key={label(r)} className="bar-row" title={title ? title(r) : `${label(r)}: ${format(value(r))}`}>
          <span>{label(r)}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(value(r) / max) * 100}%` }} /></span>
          <span className="mono strong">{format(value(r))}</span>
        </div>
      ))}
    </div>
  );
}

export const Money = ({ value, whole }) => <>{money(value, whole)}</>;

export function Avatar({ name, src, size = 36 }) {
  const ini = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return src
    ? <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{ini}</span>;
}

export function KeyVals({ rows }) {
  return (
    <dl className="kv">
      {rows.filter(([, v]) => v !== undefined).map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v === null || v === '' ? <span className="muted">—</span> : v}</dd></div>
      ))}
    </dl>
  );
}

/** Small thumbnail (profile photo) with an initials fallback. */
export function Thumb({ src, name, w = 40, h = 50 }) {
  return src
    ? <img className="thumb" src={src} alt="" width={w} height={h} style={{ width: w, height: h }} loading="lazy" />
    : <span className="thumb thumb-empty" style={{ width: w, height: h }} aria-hidden="true">{(name || '?')[0]}</span>;
}

/** Character counter for SEO fields: green inside the recommended range. */
export function Counter({ value, min, max }) {
  const n = (value || '').length;
  const tone = !n ? 'muted' : n < min ? 'warn' : n > max ? 'danger' : 'ok';
  return <small className={`counter counter-${tone}`}>{n}/{max}</small>;
}

/** Page title / meta description inputs with length guidance and a search-result preview. */
export function SeoFields({ form, set, errors = {}, fallbackTitle, fallbackDescription, path }) {
  const site = useUi().meta || {};
  return (
    <div className="stack">
      <Field label={<>Page title <Counter value={form.seoTitle} min={30} max={70} /></>} error={errors.seoTitle} hint={`Blank = “${fallbackTitle || ''}”`}>
        <input value={form.seoTitle || ''} onChange={set('seoTitle')} maxLength={70} />
      </Field>
      <Field label={<>Meta description <Counter value={form.metaDescription} min={70} max={170} /></>} error={errors.metaDescription} hint="One or two sentences shown under the title in search results">
        <textarea rows={2} value={form.metaDescription || ''} onChange={set('metaDescription')} maxLength={170} />
      </Field>
      <div className="serp" aria-label="Search result preview">
        <small>{(site.websiteUrl || 'https://example.com').replace(/^https?:\/\//, '')}{path}</small>
        <strong>{form.seoTitle || fallbackTitle}</strong>
        <p>{form.metaDescription || fallbackDescription || 'Add a meta description so search engines show a helpful summary.'}</p>
      </div>
    </div>
  );
}
