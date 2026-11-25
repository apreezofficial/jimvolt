import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { bannerImageSrc, getBanners } from '../services/bannerService.js';

const SLIDE_MS = 5000;

// Homepage banner slideshow. It is exactly as big as the "Sell your solar equipment" section
// (the .promo block) and renders nothing when there are no active banners.
export default function BannerSlideshow() {
  const [banners, setBanners] = useState([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef(null);

  useEffect(() => {
    let active = true;
    getBanners()
      .then(({ data }) => { if (active) setBanners(data.banners || []); })
      .catch(() => { /* a banner failing to load must never break the homepage */ });
    return () => { active = false; };
  }, []);

  const count = banners.length;
  const go = useCallback((next) => setIndex((current) => (count ? (next + count) % count : 0)), [count]);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (count < 2 || paused || reduceMotion) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  if (!count) return null;

  const onTouchEnd = (event) => {
    if (touchStart.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) > 40) go(index + (delta < 0 ? 1 : -1));
  };

  return (
    <section className="container" aria-roledescription="carousel" aria-label="Sponsored banners">
      <div
        className="banner-slideshow"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
        onTouchEnd={onTouchEnd}
      >
        <div className="banner-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {banners.map((banner, position) => {
            const image = (
              <img
                src={bannerImageSrc(banner.imageUrl)}
                alt={banner.altText}
                loading={position === 0 ? 'eager' : 'lazy'}
                draggable="false"
              />
            );
            return (
              <div
                className="banner-slide"
                key={banner.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${count}`}
                aria-hidden={position !== index}
              >
                {banner.linkUrl ? (
                  <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer sponsored" tabIndex={position === index ? 0 : -1}>{image}</a>
                ) : image}
              </div>
            );
          })}
        </div>

        {count > 1 && (
          <>
            <button type="button" className="banner-arrow banner-prev" onClick={() => go(index - 1)} aria-label="Previous banner"><ChevronLeft size={20} /></button>
            <button type="button" className="banner-arrow banner-next" onClick={() => go(index + 1)} aria-label="Next banner"><ChevronRight size={20} /></button>
            <div className="banner-dots">
              {banners.map((banner, position) => (
                <button
                  key={banner.id}
                  type="button"
                  className={position === index ? 'active' : ''}
                  onClick={() => go(position)}
                  aria-label={`Show banner ${position + 1}`}
                  aria-current={position === index}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
