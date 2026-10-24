// Website colour themes, picked in the CMS (Site Settings → Website theme).
// Each theme is a full set of the website's CSS variables (see src/styles.css :root); the website
// applies them to <html> when it loads.
//
//   primary*   brand colour: buttons, links, highlights;  primarySoft = tinted panels;  onPrimary = text on buttons
//   accent     secondary highlight (badges, ribbons)
//   ink        header / footer surface
//   bg/bgAlt   page backgrounds;  surface/surface2 = cards and inputs
//   text/muted body text;  line = borders
//   hero       two stops for the hero gradient
//   scheme     'dark' or 'light' (form controls and scrollbars follow it)

export const DEFAULT_THEME = 'noir-gold';

export const THEMES = [
  {
    id: 'noir-gold', name: 'Noir & Gold', description: 'Deep charcoal with champagne gold. Classic, discreet luxury.', scheme: 'dark',
    primary: ['#d4af6a', '#b8924d', '#2a2418'], onPrimary: '#17130b', accent: '#e6c98f', ink: '#0b0b0d',
    bg: ['#111114', '#17171b'], surface: ['#1c1c21', '#24242a'], text: ['#f3efe7', '#c9c3b8'], muted: '#8f897e', line: '#2e2d33', hero: ['#1e1a12', '#111114'],
  },
  {
    id: 'midnight-rose', name: 'Midnight Rose', description: 'Midnight navy with a soft rose-gold accent. Romantic and modern.', scheme: 'dark',
    primary: ['#e0a19a', '#c9837b', '#2d1f22'], onPrimary: '#1d1113', accent: '#f1c5b9', ink: '#0a0d18',
    bg: ['#0f1322', '#141a2c'], surface: ['#192036', '#212a43'], text: ['#f2eef0', '#c6c2cd'], muted: '#8c8a9c', line: '#2a3250', hero: ['#24192a', '#0f1322'],
  },
  {
    id: 'onyx-emerald', name: 'Onyx Emerald', description: 'Black onyx with a jewel-tone emerald. Bold and exclusive.', scheme: 'dark',
    primary: ['#3fbf8f', '#2f9e75', '#14281f'], onPrimary: '#06140e', accent: '#d8b874', ink: '#08090a',
    bg: ['#0e1011', '#141718'], surface: ['#1a1e1f', '#222728'], text: ['#eef3f0', '#bfc8c3'], muted: '#84908a', line: '#2a3031', hero: ['#10231b', '#0e1011'],
  },
  {
    id: 'plum-velvet', name: 'Plum Velvet', description: 'Velvet plum with warm amber highlights. Intimate and elegant.', scheme: 'dark',
    primary: ['#c99bdb', '#ad7dc1', '#2a1d31'], onPrimary: '#1b0f21', accent: '#f0b86e', ink: '#0d0811',
    bg: ['#140e18', '#1a1220'], surface: ['#22182a', '#2b2034'], text: ['#f4eef6', '#cbc0d0'], muted: '#958a9b', line: '#352a3d', hero: ['#2a1834', '#140e18'],
  },
  {
    id: 'sapphire-night', name: 'Sapphire Night', description: 'Ink black with a cool sapphire blue. Clean and confident.', scheme: 'dark',
    primary: ['#7fa8ff', '#5f8ae6', '#1a2340'], onPrimary: '#0a1124', accent: '#ffd38a', ink: '#07090f',
    bg: ['#0c0f17', '#11151f'], surface: ['#171c28', '#1f2533'], text: ['#eef2fa', '#c0c7d6'], muted: '#8890a3', line: '#283044', hero: ['#141d36', '#0c0f17'],
  },
  {
    id: 'ivory-classic', name: 'Ivory Classic', description: 'Light ivory and espresso with a gold accent. Refined daytime look.', scheme: 'light',
    primary: ['#9a7434', '#7c5c25', '#f4ecdc'], onPrimary: '#ffffff', accent: '#2c2420', ink: '#1d1916',
    bg: ['#faf7f1', '#f3eee4'], surface: ['#ffffff', '#f8f4ec'], text: ['#231d18', '#54493f'], muted: '#7d7266', line: '#e5dccd', hero: ['#efe4cf', '#faf7f1'],
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

/** CSS custom properties for a theme, e.g. { '--primary': '#d4af6a', '--primary-rgb': '212, 175, 106', … } */
export function themeVars(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES.find((x) => x.id === DEFAULT_THEME);
  return {
    '--primary': t.primary[0], '--primary-dark': t.primary[1], '--primary-soft': t.primary[2], '--primary-rgb': rgb(t.primary[0]), '--on-primary': t.onPrimary,
    '--accent': t.accent, '--accent-rgb': rgb(t.accent), '--ink': t.ink, '--ink-rgb': rgb(t.ink),
    '--bg': t.bg[0], '--bg-alt': t.bg[1], '--surface': t.surface[0], '--surface-2': t.surface[1],
    '--text': t.text[0], '--text-2': t.text[1], '--muted': t.muted, '--line': t.line,
    '--hero-a': t.hero[0], '--hero-b': t.hero[1], '--scheme': t.scheme,
  };
}

export const themeList = () => THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description, scheme: t.scheme, vars: themeVars(t.id) }));
