import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { duration, money } from '../utils/format';
import { IconCamera, IconCheck, IconHeart, IconPin, IconPlay, IconShare } from './Icons';
import { Photo, useOutside } from './Common';

export function FavoriteButton({ profile, className = '' }) {
  const { isFavorite, toggleFavorite } = useSite();
  const on = isFavorite(profile.id);
  return (
    <button type="button" className={`icon-btn ${on ? 'on' : ''} ${className}`} aria-pressed={on} aria-label={on ? `Remove ${profile.name} from favourites` : `Save ${profile.name} to favourites`}
      title={on ? 'Saved to favourites' : 'Save to favourites'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(profile.id, profile.name); }}>
      <IconHeart size={18} filled={on} />
    </button>
  );
}

/** Share a page: the phone's share sheet when available, otherwise copy link / messaging apps. */
export function ShareButton({ title, text, path }) {
  const { toast } = useSite();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(close);
  const url = `${window.location.origin}${path || window.location.pathname}`;
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    setOpen((o) => !o);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Copy the link from the address bar', 'error'); }
    setOpen(false);
  };
  const enc = encodeURIComponent;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" onClick={share} aria-haspopup="menu" aria-expanded={open} aria-label="Share" title="Share"><IconShare size={18} /></button>
      {open && (
        <div className="share-pop" role="menu">
          <button role="menuitem" onClick={copy}>Copy link</button>
          <a role="menuitem" href={`https://wa.me/?text=${enc(`${title} ${url}`)}`} target="_blank" rel="noreferrer noopener">WhatsApp</a>
          <a role="menuitem" href={`https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`} target="_blank" rel="noreferrer noopener">Telegram</a>
          <a role="menuitem" href={`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`} target="_blank" rel="noreferrer noopener">X (Twitter)</a>
          <a role="menuitem" href={`mailto:?subject=${enc(title)}&body=${enc(url)}`}>Email</a>
        </div>
      )}
    </div>
  );
}

export default function ProfileCard({ p }) {
  return (
    <Link to={`/companions/${p.slug}`} className="p-card">
      <div className="p-card-media">
        <Photo src={p.photoUrl} alt={p.photoAlt} name={p.name} />
        <div className="p-card-badges">
          {p.featured && <span className="badge badge-gold">Featured</span>}
          {p.verified && <span className="badge badge-ok"><IconCheck size={12} />Verified</span>}
        </div>
        <div className="p-card-fav"><FavoriteButton profile={p} /></div>
        <div className="p-card-over">
          <h3>{p.name} <small>{p.age}</small></h3>
          {p.location && <p><IconPin size={13} />{p.location.parent ? `${p.location.name}, ${p.location.parent}` : p.location.name}</p>}
        </div>
      </div>
      <div className="p-card-body">
        <p className="p-card-tag">{p.tagline}</p>
        <div className="p-card-meta">
          <span>{p.priceFrom != null ? <><span className="muted">from </span><strong>{money(p.priceFrom)}</strong></> : <span className="muted">Rates on request</span>}</span>
          <span className={`avail ${p.availableToday ? '' : 'off'}`}>{p.availableToday ? 'Today' : 'Not today'}</span>
        </div>
        <div className="p-card-meta" style={{ marginTop: 6 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>{p.category.name}{p.minDuration ? ` · from ${duration(p.minDuration)}` : ''}</span>
          <span className="muted row" style={{ gap: 8, fontSize: '0.78rem' }}>
            {p.photoCount > 0 && <span className="row" style={{ gap: 3 }}><IconCamera size={13} />{p.photoCount}</span>}
            {p.hasVideo && <IconPlay size={13} />}
          </span>
        </div>
      </div>
    </Link>
  );
}
