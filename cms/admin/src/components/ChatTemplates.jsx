// Saved replies for the live chat: a picker above the reply box (the Templates button, or "/" at the start of
// a reply) and a window to add, edit, reorder and delete them. {name}, {profile} and {agent} are filled in.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { Empty, Field, Modal, useAction, useForm } from './kit';

const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';

/** The template's text with the placeholders filled in for this chat. */
export function fillTemplate(body, { visitorName, profileName, agentName }) {
  return body
    .replace(/\{name\}/g, first(visitorName) || 'there')
    .replace(/\{profile\}/g, profileName || 'the companion')
    .replace(/\{agent\}/g, first(agentName) || 'the concierge');
}

export function matchTemplates(templates, query) {
  const s = query.trim().toLowerCase();
  if (!s) return templates;
  const starts = templates.filter((t) => t.title.toLowerCase().startsWith(s));
  return [...starts, ...templates.filter((t) => !starts.includes(t) && `${t.title} ${t.body}`.toLowerCase().includes(s))];
}

/**
 * The list of templates above the reply box. `search`: show a search field (opened from the button);
 * otherwise the query comes from the "/" the user is typing, and the arrow keys are handled by the reply box.
 */
export function TemplatePicker({ templates, query, onQuery, search, active, onActive, fill, onPick, onManage, onClose }) {
  const ref = useRef(null);
  const items = matchTemplates(templates || [], query);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.tpl-toggle')) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  useEffect(() => { ref.current?.querySelector('.tpl-item.on')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onActive(Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); onPick(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  return (
    <div className="tpl-pop" ref={ref}>
      {search && <input className="tpl-search" autoFocus value={query} onChange={(e) => { onQuery(e.target.value); onActive(0); }} onKeyDown={onKey} placeholder="Search templates…" aria-label="Search templates" />}
      <div className="tpl-list" role="listbox" aria-label="Templates">
        {templates === null ? <p className="muted tpl-empty">Loading…</p>
          : !templates.length ? <p className="muted tpl-empty">No templates yet. Save the replies you send often.</p>
          : !items.length ? <p className="muted tpl-empty">No template matches “{query}”.</p>
          : items.map((t, i) => (
            <button key={t.id} type="button" role="option" aria-selected={i === active} className={`tpl-item${i === active ? ' on' : ''}`}
              onMouseEnter={() => onActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(t)}>
              <strong>{t.title}</strong>
              <span>{fill(t.body)}</span>
            </button>
          ))}
      </div>
      <div className="tpl-foot">
        <small className="muted">{search ? '↑↓ to choose, Enter to insert' : 'Tip: type / at the start of a reply'}</small>
        <button type="button" className="link" onClick={onManage}>Manage templates</button>
      </div>
    </div>
  );
}

function TemplateForm({ t, onCancel, onSaved }) {
  const { form, set, errors, saving, submit } = useForm(t?.id ? { title: t.title, body: t.body } : { title: '', body: '' });
  const save = () => submit(async (f) => onSaved(await (t?.id ? api.put(`/live-chat/templates/${t.id}`, f) : api.post('/live-chat/templates', f))), 'Template saved');
  return (
    <div className="stack">
      <Field label="Title" error={errors.title} required hint="Shown in the list, e.g. Greeting or Booking link"><input value={form.title} onChange={set('title')} maxLength={80} autoFocus /></Field>
      <Field label="Text" error={errors.body} required hint="{name} = the visitor’s first name, {profile} = the profile they asked about, {agent} = your first name">
        <textarea rows={6} value={form.body} onChange={set('body')} maxLength={2000} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Back</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
      </div>
    </div>
  );
}

/** Add, edit, reorder and delete templates. onChange(list) after every change. */
export function TemplatesModal({ templates, onChange, onClose }) {
  const [editing, setEditing] = useState(null); // {} = new
  const [run] = useAction();
  const { confirm } = useUi();
  const list = templates || [];
  const move = (i, d) => {
    const order = list.map((t) => t.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    run(() => api.put('/live-chat/templates', { order })).then((r) => r && onChange(r));
  };
  const addSamples = () => run(() => api.post('/live-chat/templates/samples', {}), 'Sample templates added').then((r) => r && onChange(r));
  const remove = async (t) => {
    if (!await confirm({ title: `Delete “${t.title}”?`, danger: true, confirmLabel: 'Delete' })) return;
    const r = await run(() => api.del(`/live-chat/templates/${t.id}`), 'Template deleted');
    if (r) onChange(r);
  };
  return (
    <Modal title={editing ? (editing.id ? 'Edit template' : 'New template') : 'Reply templates'} size="wide" onClose={onClose}
      footer={!editing && <>
        <button className="btn btn-ghost" onClick={addSamples} title="Greetings, availability, booking, policies and closing replies; ones you already have are skipped">Add sample templates</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose}>Done</button>
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ New template</button>
      </>}>
      {editing ? <TemplateForm t={editing} onCancel={() => setEditing(null)} onSaved={(r) => { onChange(r); setEditing(null); }} />
        : list.length ? (
          <table className="table">
            <tbody>{list.map((t, i) => (
              <tr key={t.id}>
                <td><strong>{t.title}</strong><span className="sub tpl-preview">{t.body}</span></td>
                <td className="actions nowrap">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)}>Edit</button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => remove(t)}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <Empty title="No templates yet" text="Save greetings, booking instructions and other replies you send often, or start with our samples." icon="💬"
            action={<button className="btn btn-primary" onClick={addSamples}>Add sample templates</button>} />
        )}
    </Modal>
  );
}
