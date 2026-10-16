// Toasts, confirm/prompt dialogs and the shared option lists (/api/meta).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { setCurrency } from './format';

const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const inputRef = useRef(null);
  const loadMeta = useCallback(() => {
    setMetaError('');
    api.get('/meta').then((m) => { setCurrency(m.site.currency); setMeta(m); }).catch((e) => setMetaError(e.message));
  }, []);
  useEffect(loadMeta, [loadMeta]);
  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 3200);
  }, []);

  /** confirm({ title, message, confirmLabel, danger }) → Promise<boolean> */
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  /** prompt({ title, message, label, required, multiline }) → Promise<string|null> */
  const prompt = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, input: true, value: opts.defaultValue || '', resolve })), []);

  const close = (ok) => {
    if (dialog?.input) {
      const v = (inputRef.current?.value || '').trim();
      if (ok && dialog.required && !v) return inputRef.current?.focus();
      dialog.resolve(ok ? v : null);
    } else dialog?.resolve(ok);
    setDialog(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm, prompt, meta, metaError, loadMeta }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
      </div>
      {dialog && (
        <div className="modal-backdrop" onMouseDown={() => close(false)}>
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{dialog.title}</h3>
            {dialog.message && <p className="muted">{dialog.message}</p>}
            {dialog.input && (
              <label className="field">
                {dialog.label && <span className="label">{dialog.label}</span>}
                {dialog.multiline
                  ? <textarea ref={inputRef} rows={3} defaultValue={dialog.value} autoFocus />
                  : <input ref={inputRef} defaultValue={dialog.value} autoFocus onKeyDown={(e) => e.key === 'Enter' && close(true)} />}
              </label>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)} autoFocus={!dialog.input}>Cancel</button>
              <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{dialog.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);
