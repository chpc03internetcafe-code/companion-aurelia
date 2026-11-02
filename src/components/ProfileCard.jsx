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

// Photo first, like a gallery: the picture carries the badges, the caption below gives name, age, area and price.
export default function ProfileCard({ p }) {
  const place = p.location ? p.location.name : null;
  return (
    <Link to={`/companions/${p.slug}`} className="p-card">
      <div className="p-card-media">
        <Photo src={p.photoUrl} alt={p.photoAlt} name={p.name} />
        <div className="p-card-badges">
          {p.featured && <span className="badge badge-gold">Featured</span>}
          {p.verified && <span className="badge badge-ok" title="Photos and identity checked by our team"><IconCheck size={12} />Verified</span>}
        </div>
        <div className="p-card-fav"><FavoriteButton profile={p} /></div>
        <div className="p-card-over">
          {p.availableToday ? <span className="badge badge-live">Available today</span> : <span />}
          <span className="p-card-media-count">
            {p.photoCount > 0 && <span><IconCamera size={13} />{p.photoCount}</span>}
            {p.hasVideo && <span><IconPlay size={12} /></span>}
          </span>
        </div>
      </div>
      <div className="p-card-body">
        <div className="p-card-title">
          <h3>{p.name}</h3>
          <span>{p.age}</span>
        </div>
        <p className="p-card-sub">
          {place && <><IconPin size={13} />{place}</>}
          {place && <span aria-hidden="true">·</span>}
          {p.category.name}
        </p>
        <p className="p-card-price">
          {p.priceFrom != null ? <><span>from</span> <strong>{money(p.priceFrom)}</strong>{p.minDuration ? <span> / {duration(p.minDuration)}</span> : null}</> : <span>Rates on request</span>}
        </p>
      </div>
    </Link>
  );
}
