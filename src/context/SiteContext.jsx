// Everything the website shares: site info, categories, locations, pages and FAQs (one /site/bootstrap call),
// favourites (saved in the browser), toasts and the adults-only notice.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, store } from '../utils/api';
import { applyTheme } from '../utils/theme';
import { setCurrency } from '../utils/format';

const SiteContext = createContext(null);
const REFRESH_AFTER_MS = 60_000;
const FAV_KEY = 'aurelia-favorites';
const AGE_KEY = 'aurelia-age-ok';

export function SiteProvider({ children }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [favorites, setFavorites] = useState(() => store.get(FAV_KEY, []));
  const [ageOk, setAgeOk] = useState(() => store.get(AGE_KEY, false));
  const loadedAt = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading');
    try {
      const json = await api('GET', '/site/bootstrap');
      applyTheme(json.theme);
      setCurrency(json.site.currency);
      setData(json);
      loadedAt.current = Date.now();
      setStatus('ready');
    } catch (e) {
      if (!silent) { setError(e.message); setStatus('error'); }
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // pick up CMS edits when the visitor comes back to the tab
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > REFRESH_AFTER_MS) load({ silent: true }); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [load]);

  const toast = useCallback((message, tone = 'default') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  // ----- favourites (this browser only) -----
  const isFavorite = useCallback((id) => favorites.includes(id), [favorites]);
  const toggleFavorite = useCallback((id, name) => {
    const on = !favorites.includes(id);
    const next = on ? [id, ...favorites] : favorites.filter((x) => x !== id);
    setFavorites(next);
    store.set(FAV_KEY, next);
    toast(on ? `${name || 'Profile'} saved to favourites` : `${name || 'Profile'} removed from favourites`);
  }, [favorites, toast]);

  const confirmAge = () => { store.set(AGE_KEY, true); setAgeOk(true); };

  const value = useMemo(() => {
    if (!data) return null;
    const cities = data.locations.filter((l) => !l.parentId);
    return {
      ...data,
      cities,
      areasOf: (cityId) => data.locations.filter((l) => l.parentId === cityId),
      getLocation: (slug) => data.locations.find((l) => l.slug === slug),
      getCategory: (slug) => data.categories.find((c) => c.slug === slug),
      refresh: () => load({ silent: true }),
      favorites, isFavorite, toggleFavorite,
      ageOk, confirmAge,
      toast, toasts,
    };
  }, [data, load, favorites, isFavorite, toggleFavorite, ageOk, toast, toasts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading' && !data) {
    return <div className="boot"><span className="spinner" aria-hidden="true" /><p className="muted">Loading…</p></div>;
  }
  if (status === 'error' && !data) {
    return (
      <div className="boot">
        <h2>We’ll be right back</h2>
        <p className="muted">The website couldn’t load. Please try again in a moment.</p>
        <small className="muted">{error}</small>
        <button className="btn btn-primary" onClick={() => load()}>Try again</button>
      </div>
    );
  }
  return (
    <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
  );
}

export const useSite = () => useContext(SiteContext);
