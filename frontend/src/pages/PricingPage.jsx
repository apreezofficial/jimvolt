import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';
import { getPromotionPackages } from '../services/promotionService.js';
import { getBannerPricing } from '../services/bannerService.js';

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

function benefitList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Public price list. Posting and browsing are free; only promotions cost money.
export default function PricingPage() {
  const [packages, setPackages] = useState(null);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    let active = true;
    getPromotionPackages()
      .then(({ data }) => { if (active) setPackages(data.packages || []); })
      .catch(() => { if (active) setError('Pricing could not be loaded right now. Please try again shortly.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    getBannerPricing().then(({ data }) => setBanner(data)).catch(() => {});
  }, []);

  return (
    <div className="container section">
      <header className="section-heading">
        <p className="eyebrow">Pricing</p>
        <h1>Free to post. Pay only to get noticed.</h1>
        <p className="muted">Browsing, posting and messaging sellers cost nothing. A promotion makes an approved listing more visible for a set number of days.</p>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {!error && packages === null && <div className="panel loading-card">Loading packages…</div>}

      {packages && packages.length === 0 && (
        <EmptyState title="No promotion packages yet" text="Check back soon. Posting ads is still free." />
      )}

      {packages && packages.length > 0 && (
        <div className="pricing-grid">
          {packages.map((pkg) => (
            <article className="panel pricing-card" key={pkg.id}>
              <h2>{pkg.name}</h2>
              <p className="pricing-price">{formatNaira(pkg.price)}</p>
              <p className="muted">{pkg.duration_days} day{Number(pkg.duration_days) === 1 ? '' : 's'}</p>
              {pkg.description && <p>{pkg.description}</p>}
              {benefitList(pkg.benefits).length > 0 && (
                <ul className="pricing-benefits">
                  {benefitList(pkg.benefits).map((benefit) => (
                    <li key={benefit}><CheckCircle2 size={16} aria-hidden="true" /> {benefit}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {banner && (
        <article className="panel pricing-card" style={{ marginTop: 18 }}>
          <h2>Homepage banner</h2>
          <p className="pricing-price">{formatNaira(banner.pricePerDay)} <small>per day</small></p>
          <p>Your banner rotates in the slideshow at the top of the homepage. Choose from {banner.minDays} to {banner.maxDays} days: the more days, the more you pay. Days start when we approve your banner.</p>
          <Link className="btn btn-primary" to="/advertise">Order a banner</Link>
        </article>
      )}

      <p className="section-footer">
        <Link className="btn btn-primary" to="/post-ad">Post your ad free</Link>{' '}
        <Link className="link" to="/refund-policy">Read the refund policy</Link>
      </p>
    </div>
  );
}
