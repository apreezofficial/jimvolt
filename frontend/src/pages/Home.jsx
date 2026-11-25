import BannerSlideshow from '../components/BannerSlideshow.jsx';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ShieldCheck, MapPin, ArrowRight } from 'lucide-react';
import { CATEGORIES, FALLBACK_CATEGORY_IMAGE } from '../utils/constants.js';
import ListingSection from '../components/ListingSection.jsx';
import ImageWithFallback from '../components/ImageWithFallback.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import useAsync from '../hooks/useAsync.js';
import { getPromoted, getDiscover, getRecent, getPopular, getPopularLocations, getVerifiedSellers } from '../services/listingService.js';

export default function Home() {
  useEffect(() => { document.title = 'Jimvolt | Buy and Sell Solar, Inverters and Batteries in Nigeria'; }, []);
  const sellers = useAsync(getVerifiedSellers);
  const locations = useAsync(getPopularLocations);

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <h1>Power your home or business with the right solar kit.</h1>
          <p>Compare panels, inverters and batteries from sellers and installers across Nigeria.</p>
          <div className="hero-actions">
            <Link to="/ads" className="btn btn-white">Browse adverts</Link>
            <Link to="/post-ad" className="btn btn-green">Post your ad</Link>
          </div>
        </div>
      </section>

      <section className="container cats-wrap" aria-label="Categories">
        <div className="cats">
          {CATEGORIES.map(({ slug, name, image }) => (
            <Link key={slug} to={`/ads?category=${slug}`} className="cat">
              <ImageWithFallback className="cat-image" src={image} fallbackSrc={FALLBACK_CATEGORY_IMAGE} alt={name} loading="lazy" decoding="async" />
              <span>{name}</span>
            </Link>
          ))}
        </div>
      </section>

      <ListingSection title="Featured Products" subtitle="Sponsored placements from renewable-energy sellers" loader={getPromoted} to="/ads?featured=true" />
      <ListingSection title="Discover products" loader={getDiscover} to="/ads?sort=random" skeletons={8} />
      <ListingSection title="Recently posted" loader={getRecent} to="/ads?sort=newest" skeletons={8} />

      <BannerSlideshow />

      <section className="container">
        <div className="promo">
          <div>
            <h2>Sell your solar equipment faster</h2>
            <p>Post in minutes, reach buyers in every state, and earn a verified badge to build trust.</p>
          </div>
          <Link to="/post-ad" className="btn btn-white">Post your ad <ArrowRight size={16} /></Link>
        </div>
      </section>

      <ListingSection title="Popular right now" loader={getPopular} to="/ads?sort=popular" />

      <section className="section container">
        <div className="section-head">
          <div><h2>Verified sellers</h2><p className="muted">Businesses checked by the Jimvolt team</p></div>
          <Link to="/sellers" className="link">See all</Link>
        </div>
        <div className="sellers">
          {(sellers.data || []).map((s) => (
            <Link to={s.username ? `/@${s.username}` : `/sellers/${s.id}`} key={s.id} className="seller-card">
              <UserAvatar src={s.profileImage} name={s.name} className="avatar" />
              <span>
                <strong>{s.name} <BadgeCheck size={16} className="ok" aria-label="Verified" /></strong>
                <small>{s.state} · {s.ads} adverts</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head"><h2>Shop by location</h2></div>
        <div className="locs">
          {(locations.data || []).map((l) => (
            <Link key={l.name} to={`/ads?state=${encodeURIComponent(l.name)}`} className="loc">
              <MapPin size={18} aria-hidden="true" />
              <strong>{l.name}</strong>
              <small>{l.count.toLocaleString()} adverts</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="container trust">
        <ShieldCheck size={22} aria-hidden="true" />
        <p>Meet in person, inspect the item and pay only when satisfied. <Link to="/safety" className="link">Read safety tips</Link></p>
      </section>
    </>
  );
}
