import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, MapPin, Menu, X, Plus, User, Heart, LayoutDashboard, ShieldCheck, XCircle, Clock3 } from 'lucide-react';
import { NIGERIAN_STATES } from '../utils/constants.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getSearchSuggestions } from '../services/listingService.js';
import { formatNaira } from '../utils/format.js';
import UserAvatar from './UserAvatar.jsx';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated, favoriteCount } = useAuth();

  useEffect(() => {
    setQ(searchParams.get('q') || '');
    setState(searchParams.get('state') || '');
  }, [location.pathname, location.search, searchParams]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError('');
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setSuggestionsError('');
      try {
        setSuggestions(await getSearchSuggestions(term, controller.signal));
      } catch (error) {
        if (error.name !== 'CanceledError' && error.code !== 'ERR_CANCELED') {
          setSuggestionsError('Search suggestions are temporarily unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const submit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (state) p.set('state', state);
    navigate(`/search${p.size ? `?${p.toString()}` : ''}`);
    setOpen(false);
    setFocused(false);
  };

  const openSuggestion = (id) => {
    navigate(`/ads/${id}`);
    setFocused(false);
    setSuggestions([]);
    setOpen(false);
  };

  const clearSearch = () => {
    setQ('');
    setSuggestions([]);
    setSuggestionsError('');
  };

  return (
    <header className="nav">
      <div className="container nav-row">
        <Link to="/" className="logo" aria-label="Jimvolt home">
          <img className="brand-logo navbar-logo" src="/jimvolt-logo.png" alt="Jimvolt" />
        </Link>

        <form className="search search-with-suggestions" onSubmit={submit} role="search">
          <label className="search-loc">
            <MapPin size={16} aria-hidden="true" />
            <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Select state">
              <option value="">All Nigeria</option>
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFocused(false);
            }}
            placeholder="Search products, brands, specifications"
            aria-label="Search products"
            aria-autocomplete="list"
            aria-expanded={focused && q.trim().length >= 2}
            aria-controls="global-search-suggestions"
          />
          {q && <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search"><XCircle size={18} /></button>}
          <button className="search-btn" aria-label="Search"><Search size={18} /></button>
          {focused && q.trim().length >= 2 && <div className="search-suggestions" id="global-search-suggestions" role="listbox">
            {suggestionsLoading && <div className="suggestion-message" role="status" aria-label="Searching products" style={{ display: 'grid', gap: 8 }}><span className="shimmer shimmer-line" style={{ width: '70%' }} /><span className="shimmer shimmer-line" style={{ width: '50%' }} /></div>}
            {!suggestionsLoading && suggestionsError && <div className="suggestion-message">{suggestionsError}</div>}
            {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && <div className="suggestion-message">No matching products found. Search all listings?</div>}
            {!suggestionsLoading && suggestions.map((item) => <button type="button" role="option" key={item.id} className="search-suggestion" onMouseDown={(event) => event.preventDefault()} onClick={() => openSuggestion(item.id)}>
              <span><strong>{item.title}</strong><small>{[item.brand, item.category_name, `${item.city}, ${item.state}`].filter(Boolean).join(' · ')}</small></span>
              <b>{formatNaira(item.price)}</b>
            </button>)}
            <button type="submit" className="suggestion-search-all" onMouseDown={(event) => event.preventDefault()}>Search all for “{q.trim()}”</button>
          </div>}
        </form>

        {isAuthenticated ? <>
          <nav className={`nav-links ${open ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/ads" onClick={() => setOpen(false)}>Browse</NavLink>
            <NavLink to="/saved" onClick={() => setOpen(false)}><Heart size={16} /> Saved{favoriteCount > 0 && <span className="nav-message-count nav-favorite-count">{favoriteCount > 99 ? '99+' : favoriteCount}</span>}</NavLink>
            <NavLink to="/recently-viewed" onClick={() => setOpen(false)}><Clock3 size={16} /> Recently viewed</NavLink>
            <NavLink to="/dashboard" onClick={() => setOpen(false)}><LayoutDashboard size={16} /> Dashboard</NavLink>
            {['admin', 'super_admin'].includes(user?.role) && <NavLink to="/admin" onClick={() => setOpen(false)}><ShieldCheck size={16} /> Admin</NavLink>}
            <NavLink to="/profile" onClick={() => setOpen(false)}><UserAvatar src={user?.profile_image} name={user?.full_name} className="nav-user-avatar" /> {user?.full_name?.split(' ')[0] || 'Profile'}</NavLink>
            <Link to="/post-ad" className="btn btn-green" onClick={() => setOpen(false)}><Plus size={16} /> Post your ad</Link>
          </nav>
          <button className="burger" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>{open ? <X size={22} /> : <Menu size={22} />}</button>
        </> : <>
          <nav className={`nav-links ${open ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/ads" onClick={() => setOpen(false)}>Browse</NavLink>
            <NavLink to="/sellers" onClick={() => setOpen(false)}>Sellers</NavLink>
            <NavLink to="/saved" onClick={() => setOpen(false)}><Heart size={16} /> Saved{favoriteCount > 0 && <span className="nav-message-count nav-favorite-count">{favoriteCount > 99 ? '99+' : favoriteCount}</span>}</NavLink>
            <Link to="/login" className="btn btn-white guest-sign-in" onClick={() => setOpen(false)}><User size={16} /> Sign in</Link>
            <Link to="/register" className="btn btn-green" onClick={() => setOpen(false)}><Plus size={16} /> Create account</Link>
          </nav>
          <button className="burger" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>{open ? <X size={22} /> : <Menu size={22} />}</button>
        </>}

      </div>
    </header>
  );
}
