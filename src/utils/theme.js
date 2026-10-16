// Colour theme picked in the CMS (Site Settings → Website theme). The bootstrap response carries the
// theme's CSS variables; they're set on <html> and remembered so the next visit starts in the right colours.
import { store } from './api';

const KEY = 'aurelia-theme';

export function applyTheme(theme) {
  if (!theme?.vars) return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) if (name !== '--scheme') root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.vars['--scheme'] || 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--ink']);
  store.set(KEY, theme);
}

export const applySavedTheme = () => applyTheme(store.get(KEY));
