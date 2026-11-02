// Colour theme picked in the CMS (Site Settings → Website theme). The bootstrap response carries the theme's
// dark and light CSS variables, the appearance to use ('dark' | 'light' | 'auto' = the visitor's device) and
// whether visitors may switch it themselves. The variables are set on <html> and the theme is remembered,
// so the next visit starts in the right colours.
import { useEffect, useState } from 'react';
import { store } from './api';

const KEY = 'aurelia-theme';
const PICK_KEY = 'aurelia-scheme'; // the visitor's own choice, when the switch is allowed
const CHANGE_EVENT = 'aurelia:scheme';

let current = null;
const prefersLight = () => !!window.matchMedia?.('(prefers-color-scheme: light)').matches;

/** 'dark' or 'light': the visitor's own choice (if allowed), else the CMS setting, else their device. */
function schemeOf(theme) {
  if (theme.switch) {
    const pick = store.get(PICK_KEY);
    if (pick === 'dark' || pick === 'light') return pick;
  }
  if (theme.mode === 'dark' || theme.mode === 'light') return theme.mode;
  return prefersLight() ? 'light' : 'dark';
}

export function applyTheme(theme) {
  if (!theme?.dark || !theme?.light) return; // nothing saved yet, or saved by an older version of the site
  current = theme;
  const scheme = schemeOf(theme);
  const vars = theme[scheme];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  root.dataset.scheme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--ink']);
  store.set(KEY, theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const applySavedTheme = () => applyTheme(store.get(KEY));

// 'auto': follow the device when it switches between light and dark (e.g. at sunset).
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (current) applyTheme(current); });

/** For the header switch: { scheme, canSwitch, toggle }. */
export function useScheme() {
  const read = () => ({ scheme: document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark', canSwitch: !!current?.switch });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener(CHANGE_EVENT, update);
    return () => window.removeEventListener(CHANGE_EVENT, update);
  }, []);
  const toggle = () => {
    if (!current) return;
    store.set(PICK_KEY, state.scheme === 'light' ? 'dark' : 'light');
    applyTheme(current);
  };
  return { ...state, toggle };
}
