import { Link } from 'react-router-dom';
import { CATEGORIES } from '../utils/constants.js';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <img className="brand-logo footer-logo" src="/jimvolt-logo.png" alt="Jimvolt" />
          <p className="footer-note">Nigeria's marketplace for solar, storage and clean energy. Buy from verified sellers or sell to buyers nationwide.</p>
        </div>
        <div>
          <h4>Categories</h4>
          <ul>{CATEGORIES.slice(0, 6).map((c) => <li key={c.slug}><Link to={`/ads?category=${c.slug}`}>{c.name}</Link></li>)}</ul>
        </div>
        <div>
          <h4>Jimvolt</h4>
          <ul>
            <li><Link to="/post-ad">Post your ad</Link></li>
            <li><Link to="/saved">Wishlist</Link></li>
            <li><Link to="/sellers">Verified sellers</Link></li>
            <li><Link to="/safety">Safety tips</Link></li>
            <li><Link to="/help">Help centre</Link></li>
            <li><Link to="/pricing">Pricing</Link></li>
            <li><Link to="/advertise">Advertise with us</Link></li>
            <li><Link to="/contact">Contact us</Link></li>
          </ul>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><Link to="/terms">Terms of use</Link></li>
            <li><Link to="/privacy">Privacy policy</Link></li>
            <li><Link to="/about">About Jimvolt</Link></li>
            <li><Link to="/refund-policy">Refund policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="container footer-base">© {new Date().getFullYear()} Jimvolt. All prices in Nigerian Naira (₦).</div>
    </footer>
  );
}
