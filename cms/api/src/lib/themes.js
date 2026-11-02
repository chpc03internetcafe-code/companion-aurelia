// Website colour themes, picked in the CMS (Site Settings → Website theme).
// Every theme has a dark and a light palette; the appearance setting (themeMode) says which one visitors get:
// 'dark', 'light', or 'auto' (follows the visitor's device). With themeSwitch on, visitors can also flip it
// themselves from the header (remembered in their browser). Each palette is a full set of the website's
// CSS variables (see src/styles.css :root); the website applies them to <html> when it loads.
//
//   primary*   brand colour: buttons, links, highlights;  primarySoft = tinted panels;  onPrimary = text on buttons
//   accent     secondary highlight (badges, ribbons, the light end of the button gradient)
//   ink        header / footer surface
//   bg/bgAlt   page backgrounds;  surface/surface2 = cards and inputs
//   text/muted body text;  line = borders
//   hero       two stops for the hero gradient

export const DEFAULT_THEME = 'noir-gold';
export const THEME_MODES = ['dark', 'light', 'auto'];

export const THEMES = [
  {
    id: 'noir-gold', name: 'Noir & Gold', description: 'Deep charcoal with champagne gold. Classic, discreet luxury.', scheme: 'dark',
    dark: {
      primary: ['#d4af6a', '#b8924d', '#2a2418'], onPrimary: '#17130b', accent: '#e6c98f', ink: '#0b0b0d',
      bg: ['#111114', '#17171b'], surface: ['#1c1c21', '#24242a'], text: ['#f3efe7', '#c9c3b8'], muted: '#8f897e', line: '#2e2d33', hero: ['#1e1a12', '#111114'],
    },
    light: {
      primary: ['#a07a35', '#7f5f24', '#f5ecda'], onPrimary: '#ffffff', accent: '#c9a35e', ink: '#fffcf6',
      bg: ['#faf7f1', '#f3eee4'], surface: ['#ffffff', '#f6f1e7'], text: ['#1f1a14', '#4e463c'], muted: '#776c5f', line: '#e6dccb', hero: ['#f1e6d0', '#faf7f1'],
    },
  },
  {
    id: 'midnight-rose', name: 'Midnight Rose', description: 'Midnight navy with a soft rose-gold accent. Romantic and modern.', scheme: 'dark',
    dark: {
      primary: ['#e0a19a', '#c9837b', '#2d1f22'], onPrimary: '#1d1113', accent: '#f1c5b9', ink: '#0a0d18',
      bg: ['#0f1322', '#141a2c'], surface: ['#192036', '#212a43'], text: ['#f2eef0', '#c6c2cd'], muted: '#8c8a9c', line: '#2a3250', hero: ['#24192a', '#0f1322'],
    },
    light: {
      primary: ['#b4605a', '#984a44', '#f8e9e6'], onPrimary: '#ffffff', accent: '#d98f84', ink: '#fffafa',
      bg: ['#fbf7f7', '#f4eded'], surface: ['#ffffff', '#f8f1f1'], text: ['#22192a', '#4f4558'], muted: '#796f83', line: '#eadfe2', hero: ['#f6e3e1', '#fbf7f7'],
    },
  },
  {
    id: 'onyx-emerald', name: 'Onyx Emerald', description: 'Black onyx with a jewel-tone emerald. Bold and exclusive.', scheme: 'dark',
    dark: {
      primary: ['#3fbf8f', '#2f9e75', '#14281f'], onPrimary: '#06140e', accent: '#d8b874', ink: '#08090a',
      bg: ['#0e1011', '#141718'], surface: ['#1a1e1f', '#222728'], text: ['#eef3f0', '#bfc8c3'], muted: '#84908a', line: '#2a3031', hero: ['#10231b', '#0e1011'],
    },
    light: {
      primary: ['#1d8560', '#166a4c', '#e3f3ec'], onPrimary: '#ffffff', accent: '#3fbf8f', ink: '#fbfdfc',
      bg: ['#f6f9f7', '#edf3ef'], surface: ['#ffffff', '#f3f7f4'], text: ['#14201b', '#3f4b45'], muted: '#68776f', line: '#dbe5df', hero: ['#dcefe6', '#f6f9f7'],
    },
  },
  {
    id: 'plum-velvet', name: 'Plum Velvet', description: 'Velvet plum with warm amber highlights. Intimate and elegant.', scheme: 'dark',
    dark: {
      primary: ['#c99bdb', '#ad7dc1', '#2a1d31'], onPrimary: '#1b0f21', accent: '#f0b86e', ink: '#0d0811',
      bg: ['#140e18', '#1a1220'], surface: ['#22182a', '#2b2034'], text: ['#f4eef6', '#cbc0d0'], muted: '#958a9b', line: '#352a3d', hero: ['#2a1834', '#140e18'],
    },
    light: {
      primary: ['#874ca0', '#6d3a84', '#f2e8f6'], onPrimary: '#ffffff', accent: '#b07cc6', ink: '#fdfaff',
      bg: ['#faf6fb', '#f2ebf4'], surface: ['#ffffff', '#f7f1f8'], text: ['#22162a', '#4d4054'], muted: '#786b7f', line: '#e6dbea', hero: ['#efe0f4', '#faf6fb'],
    },
  },
  {
    id: 'sapphire-night', name: 'Sapphire Night', description: 'Ink black with a cool sapphire blue. Clean and confident.', scheme: 'dark',
    dark: {
      primary: ['#7fa8ff', '#5f8ae6', '#1a2340'], onPrimary: '#0a1124', accent: '#ffd38a', ink: '#07090f',
      bg: ['#0c0f17', '#11151f'], surface: ['#171c28', '#1f2533'], text: ['#eef2fa', '#c0c7d6'], muted: '#8890a3', line: '#283044', hero: ['#141d36', '#0c0f17'],
    },
    light: {
      primary: ['#2f5fd0', '#2349a8', '#e6edfc'], onPrimary: '#ffffff', accent: '#5f8ae6', ink: '#fbfcff',
      bg: ['#f6f8fc', '#edf1f8'], surface: ['#ffffff', '#f3f6fb'], text: ['#121a2b', '#3d475a'], muted: '#677186', line: '#dbe2ee', hero: ['#dfe8fb', '#f6f8fc'],
    },
  },
  {
    id: 'ivory-classic', name: 'Ivory Classic', description: 'Ivory and espresso with a gold accent. Refined daytime look.', scheme: 'light',
    dark: {
      primary: ['#d1a85f', '#b08a45', '#2b2216'], onPrimary: '#1a140c', accent: '#e8cf9c', ink: '#14100d',
      bg: ['#1a1511', '#211b16'], surface: ['#26201a', '#2f2720'], text: ['#f5eee4', '#cfc4b5'], muted: '#978a7a', line: '#3a3129', hero: ['#2b2116', '#1a1511'],
    },
    light: {
      primary: ['#9a7434', '#7c5c25', '#f4ecdc'], onPrimary: '#ffffff', accent: '#b8924d', ink: '#fffdf8',
      bg: ['#faf7f1', '#f3eee4'], surface: ['#ffffff', '#f8f4ec'], text: ['#231d18', '#54493f'], muted: '#786d61', line: '#e5dccd', hero: ['#efe4cf', '#faf7f1'],
    },
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
const findTheme = (id) => THEMES.find((x) => x.id === id) || THEMES.find((x) => x.id === DEFAULT_THEME);

/** CSS custom properties for one palette of a theme, e.g. { '--primary': '#d4af6a', '--primary-rgb': '212, 175, 106', … } */
export function themeVars(id, scheme = findTheme(id).scheme) {
  const t = findTheme(id)[scheme === 'light' ? 'light' : 'dark'];
  return {
    '--primary': t.primary[0], '--primary-dark': t.primary[1], '--primary-soft': t.primary[2], '--primary-rgb': rgb(t.primary[0]), '--on-primary': t.onPrimary,
    '--accent': t.accent, '--accent-rgb': rgb(t.accent), '--ink': t.ink, '--ink-rgb': rgb(t.ink),
    '--bg': t.bg[0], '--bg-alt': t.bg[1], '--surface': t.surface[0], '--surface-2': t.surface[1],
    '--text': t.text[0], '--text-2': t.text[1], '--muted': t.muted, '--line': t.line,
    '--hero-a': t.hero[0], '--hero-b': t.hero[1],
  };
}

/** The appearance in use: the saved setting, or the theme's own default when none was chosen yet. */
export const themeMode = (settings) => (THEME_MODES.includes(settings.themeMode) ? settings.themeMode : findTheme(settings.theme).scheme);

/** What the website needs: both palettes, which one to use, and whether visitors may switch. */
export const siteTheme = (settings) => ({
  id: findTheme(settings.theme).id,
  mode: themeMode(settings),
  switch: settings.themeSwitch === '1',
  dark: themeVars(settings.theme, 'dark'),
  light: themeVars(settings.theme, 'light'),
});

export const themeList = () => THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description, scheme: t.scheme, dark: themeVars(t.id, 'dark'), light: themeVars(t.id, 'light') }));
