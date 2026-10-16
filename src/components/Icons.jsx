// Small line icons (24×24, currentColor).
const I = ({ d, size = 20, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const IconCalendar = (p) => <I {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></I>;
export const IconClock = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
export const IconPin = (p) => <I {...p}><path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></I>;
export const IconMail = (p) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6 8.5 7 8.5-7" /></I>;
export const IconPhone = (p) => <I {...p} d="M5 3.5h3l1.5 4-2 1.2a11 11 0 0 0 5.8 5.8l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.7 2 2 0 0 1 5 3.5Z" />;
export const IconUser = (p) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></I>;
export const IconMenu = (p) => <I {...p} d="M4 7h16M4 12h16M4 17h16" />;
export const IconClose = (p) => <I {...p} d="M6 6l12 12M18 6 6 18" />;
export const IconCheck = (p) => <I {...p} d="m5 12.5 4.5 4.5L19 7.5" />;
export const IconChevron = (p) => <I {...p} d="m9 6 6 6-6 6" />;
export const IconBack = (p) => <I {...p} d="m15 6-6 6 6 6" />;
export const IconShield = (p) => <I {...p}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></I>;
export const IconHeart = ({ filled, ...p }) => <I {...p} fill={filled ? 'currentColor' : 'none'} d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />;
export const IconShare = (p) => <I {...p}><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" /></I>;
export const IconFilter = (p) => <I {...p} d="M4 6h16M7 12h10M10 18h4" />;
export const IconSearch = (p) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>;
export const IconLock = (p) => <I {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></I>;
export const IconCrown = (p) => <I {...p} d="M4 18h16M5 16l-1-9 5 4 3-6 3 6 5-4-1 9H5Z" />;
export const IconPlay = (p) => <I {...p}><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" /></I>;
export const IconCamera = (p) => <I {...p}><path d="M4 8h3l2-2.5h6L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></I>;
export const IconGlobe = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></I>;
export const IconSparkle = (p) => <I {...p} d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />;
export const IconChat = (p) => <I {...p} d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 3.5Z" />;
export const IconInstagram = (p) => <I {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" /></I>;
export const IconSend = (p) => <I {...p} d="M21 3 3 10.5l7 2.5 2.5 7L21 3ZM10 13l4.5-4.5" />;
