// Section editor shared by content pages, posts and location landing pages:
// paragraphs, bullet lists, tables, figures and callouts, with a live preview.
import { Field } from './kit';

export const NEW_SECTION = {
  text: { type: 'text', heading: '', body: '' },
  list: { type: 'list', heading: '', items: [''] },
  table: { type: 'table', heading: '', columns: ['Column 1', 'Column 2'], rows: [['', '']] },
  stats: { type: 'stats', items: [{ value: '', label: '' }] },
  callout: { type: 'callout', heading: '', body: '' },
};
const LABELS = { text: 'Paragraph', list: 'Bullet list', table: 'Table', stats: 'Figures', callout: 'Callout box' };

function SectionFields({ s, onChange }) {
  const set = (patch) => onChange({ ...s, ...patch });
  return (
    <div className="stack">
      {s.type !== 'stats' && <Field label="Heading"><input value={s.heading || ''} onChange={(e) => set({ heading: e.target.value })} /></Field>}
      {(s.type === 'text' || s.type === 'callout') && <Field label="Text" hint="A blank line starts a new paragraph"><textarea rows={4} value={s.body} onChange={(e) => set({ body: e.target.value })} /></Field>}
      {s.type === 'list' && <Field label="Bullets" hint="One per line"><textarea rows={5} value={s.items.join('\n')} onChange={(e) => set({ items: e.target.value.split('\n') })} /></Field>}
      {s.type === 'stats' && s.items.map((it, i) => (
        <div key={i} className="row">
          <input value={it.value} onChange={(e) => set({ items: s.items.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder="100%" style={{ width: 110 }} aria-label="Figure" />
          <input value={it.label} onChange={(e) => set({ items: s.items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} placeholder="profiles verified" style={{ flex: 1 }} aria-label="Label" />
          <button type="button" className="icon-btn" onClick={() => set({ items: s.items.filter((_, k) => k !== i) })} aria-label="Remove">✕</button>
        </div>
      ))}
      {s.type === 'stats' && <div><button type="button" className="btn btn-sm btn-soft" onClick={() => set({ items: [...s.items, { value: '', label: '' }] })}>+ Figure</button></div>}
      {s.type === 'table' && (
        <>
          <Field label="Columns" hint="Separate with |"><input value={s.columns.join(' | ')} onChange={(e) => set({ columns: e.target.value.split('|').map((c) => c.trim()) })} /></Field>
          <Field label="Rows" hint="One row per line, cells separated with |"><textarea rows={5} value={s.rows.map((r) => r.join(' | ')).join('\n')} onChange={(e) => set({ rows: e.target.value.split('\n').map((l) => l.split('|').map((c) => c.trim())) })} /></Field>
        </>
      )}
    </div>
  );
}

export function SectionsEditor({ sections, onChange, editable = true }) {
  const move = (i, d) => {
    const next = [...sections];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="stack">
      {sections.map((s, i) => (
        <div key={i} className="card">
          <div className="card-head">
            <strong>{LABELS[s.type]}</strong>
            {editable && (
              <div className="row">
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" className="icon-btn" disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" className="icon-btn" onClick={() => onChange(sections.filter((_, k) => k !== i))} aria-label="Remove section">✕</button>
              </div>
            )}
          </div>
          <div className="card-body"><SectionFields s={s} onChange={(x) => onChange(sections.map((y, k) => (k === i ? x : y)))} /></div>
        </div>
      ))}
      {editable && <div className="row">{Object.keys(NEW_SECTION).map((t) => <button key={t} type="button" className="btn btn-sm btn-soft" onClick={() => onChange([...sections, structuredClone(NEW_SECTION[t])])}>+ {LABELS[t]}</button>)}</div>}
    </div>
  );
}

export function SectionsPreview({ title, kicker, intro, sections }) {
  return (
    <div style={{ fontSize: 14 }}>
      {kicker && <small style={{ color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{kicker}</small>}
      {title && <h1 style={{ margin: '4px 0 8px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 30 }}>{title}</h1>}
      {intro && <p className="muted" style={{ fontSize: 15 }}>{intro}</p>}
      {sections.map((s, i) => (
        <div key={i} style={{ marginTop: 18 }}>
          {s.heading && <h3 style={{ marginBottom: 6 }}>{s.heading}</h3>}
          {s.type === 'text' && <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>}
          {s.type === 'callout' && <div style={{ background: 'var(--primary-soft)', borderRadius: 10, padding: 14, whiteSpace: 'pre-wrap' }}>{s.body}</div>}
          {s.type === 'list' && <ul style={{ paddingLeft: 18 }}>{s.items.filter((x) => x.trim()).map((x, k) => <li key={k}>{x}</li>)}</ul>}
          {s.type === 'stats' && <div className="row" style={{ gap: 20 }}>{s.items.map((x, k) => <div key={k}><strong style={{ fontSize: 22, color: 'var(--primary-dark)' }}>{x.value}</strong><div className="muted">{x.label}</div></div>)}</div>}
          {s.type === 'table' && <table className="table compact" style={{ border: '1px solid var(--line)' }}><thead><tr>{s.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead><tbody>{s.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>}
        </div>
      ))}
    </div>
  );
}

/** Removes empty bullets before saving. */
export const cleanSections = (sections) => sections.map((s) => (s.type === 'list' ? { ...s, items: s.items.filter((x) => x.trim()) } : s));
