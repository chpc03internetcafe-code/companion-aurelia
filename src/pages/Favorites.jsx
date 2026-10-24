import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../context/SiteContext';
import { api } from '../utils/api';
import { useSeo } from '../utils/seo';
import ProfileCard from '../components/ProfileCard';
import { CardsSkeleton, Empty, PageHero } from '../components/Common';

export default function Favorites() {
  const { favorites } = useSite();
  const [items, setItems] = useState(null);
  const key = favorites.join(',');
  useSeo({ title: 'Favourites', noindex: true });
  useEffect(() => {
    if (!favorites.length) { setItems([]); return; }
    api('POST', '/site/profiles/cards', { ids: favorites }).then(setItems).catch(() => setItems([]));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHero compact kicker="Saved" title="Your favourites" text="Saved in this browser." />
      <section className="section" style={{ paddingTop: 30 }}>
        <div className="container">
          {!items ? <CardsSkeleton count={4} className="grid-cards four" /> : items.length ? <div className="grid-cards four">{items.map((p) => <ProfileCard key={p.id} p={p} />)}</div>
            : <Empty title="No favourites yet" text="Tap the heart on any profile to save it here." action={<Link to="/companions" className="btn btn-primary">Browse companions</Link>} />}
        </div>
      </section>
    </>
  );
}
