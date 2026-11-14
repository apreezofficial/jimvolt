import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Bell, CheckCircle2, CircleHelp, Eye, FileCheck2, FolderOpen,
  LayoutDashboard, Menu, MessageSquareText, Plus, Search, Settings, ShieldCheck,
  TimerReset, Trash2, UserCircle2, X, XCircle, Copy, Pause, Play, Pencil, ExternalLink,
  Megaphone, Heart,
} from 'lucide-react';
import { Link, NavLink, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import LogoutAction from '../components/LogoutAction.jsx';
import { getCategories } from '../services/listingService.js';
import { deleteAd } from '../services/listingService.js';
import {
  duplicateSellerAd, getAdvertisementAnalytics, getSellerAds,
  getSellerAnalytics, getSellerDashboard, getSellerNotifications, getSellerVerification,
  markSellerNotificationRead, submitSellerVerification, updateSellerVerification,
  updateSellerAdStatus,
} from '../services/sellerService.js';
import { NIGERIAN_STATES } from '../utils/constants.js';
import { formatNaira } from '../utils/format.js';
import { resolveImageUrl } from '../utils/imageUrl.js';
import { DOCUMENT_ACCEPT, prepareDocument } from '../utils/imageFiles.js';
import VerifiedBusinessBadge from '../components/VerifiedBusinessBadge.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import {
  getMyPromotions, getPromotionPackages, initializePromotion, verifyPromotion,
} from '../services/promotionService.js';

const navigation = [
  { label: 'Overview', path: '/dashboard', icon: LayoutDashboard },
  { label: 'My Advertisements', path: '/dashboard/ads', icon: FolderOpen },
  { label: 'Post New Ad', path: '/post-ad', icon: Plus },
  { label: 'Messages', path: '/messages', icon: MessageSquareText },
  { label: 'Promote Your Products', path: '/dashboard/promotions', icon: Megaphone },
  { label: 'Analytics', path: '/dashboard/analytics', icon: BarChart3 },
  { label: 'Verification', path: '/dashboard/verification', icon: FileCheck2 },
  { label: 'Notifications', path: '/dashboard/notifications', icon: Bell },
  { label: 'Account Settings', path: '/account-settings', icon: Settings },
];

const sectionTitles = {
  '/dashboard': 'Overview',
  '/dashboard/ads': 'My Advertisements',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/verification': 'Seller Verification',
  '/dashboard/notifications': 'Notifications',
};

function messageFrom(error, fallback) {
  return error.response?.data?.message || fallback;
}

export default function DashboardPage() {
  const { user, unreadMessageCount } = useAuth();
  const location = useLocation();
  const isAnalyticsPath = location.pathname.startsWith('/dashboard/analytics');
  const [unread, setUnread] = useState(0);
  const [unreadError, setUnreadError] = useState('');
  const [toast, setToast] = useState(location.state?.notice || '');
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = isAnalyticsPath ? 'Analytics' : sectionTitles[location.pathname] || 'Overview';

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);

  useEffect(() => {
    let active = true;
    setUnreadError('');
    getSellerNotifications()
      .then(({ data }) => active && setUnread(data.notifications.filter((item) => !item.is_read).length))
      .catch((requestError) => {
        if (active) setUnreadError(requestError.response?.data?.message || 'Notification status could not be loaded.');
      });
    return () => { active = false; };
  }, [location.pathname]);

  return (
    <div className={`dashboard-shell seller-dashboard-shell${mobileOpen ? ' mobile-open' : ''}`}>
      {mobileOpen && <button className="seller-drawer-overlay" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className="dashboard-sidebar seller-sidebar" id="seller-navigation">
        <div className="seller-sidebar-heading">
          <Link to="/" className="dashboard-brand" onClick={() => setMobileOpen(false)} aria-label="Jimvolt home">
            <img className="brand-logo seller-brand-image" src="/jimvolt-logo.png" alt="Jimvolt" />
          </Link>
          <button type="button" className="seller-drawer-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <Link to="/profile" className="seller-mini-profile" onClick={() => setMobileOpen(false)} aria-label="Open your profile">
          <UserAvatar src={user?.profile_image} name={user?.full_name} className="seller-mini-avatar" />
          <div>
            <strong>{user?.full_name || 'Seller'} <VerifiedBusinessBadge verified={Boolean(user?.is_verified)} /></strong>
            <small>{user?.email || (user?.is_verified ? 'Verified seller' : 'Awaiting verification')}</small>
          </div>
        </Link>
        <nav className="dashboard-nav" aria-label="Seller dashboard">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink key={label} to={path} end={path === '/dashboard'} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive || (path === '/dashboard/analytics' && isAnalyticsPath) ? 'active' : ''}>
              <Icon size={18} /><span>{label}</span>
              {label === 'Messages' && unreadMessageCount > 0 && (
                <span className="notification-count" aria-label={`${unreadMessageCount} unread messages`}>
                  {unreadMessageCount.toLocaleString()}
                </span>
              )}
              {label === 'Notifications' && unread > 0 && <span className="notification-count">{unread}</span>}
            </NavLink>
          ))}
          {user?.role === 'admin' && <Link to="/admin" onClick={() => setMobileOpen(false)}><ShieldCheck size={18} /><span>Admin review</span></Link>}
          <LogoutAction className="dashboard-logout" label="Logout" />
        </nav>
      </aside>

      <main className="dashboard-main seller-dashboard-main">
        <header className="dashboard-header seller-dashboard-header">
          <button type="button" className="seller-mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="seller-navigation" onClick={() => setMobileOpen(true)}>
            <Menu size={21} />
          </button>
          <div className="seller-dashboard-welcome">
            <UserAvatar src={user?.profile_image} name={user?.full_name} className="seller-welcome-avatar" />
            <div>
            <p className="eyebrow"><Link to="/dashboard">Dashboard</Link> / {title}</p>
            <h1>{title === 'Overview' ? `Welcome back, ${user?.full_name?.split(' ')[0] || 'seller'}.` : title}</h1>
            </div>
          </div>
          <div className="dashboard-header-actions">
            <Link to="/dashboard/notifications" className="icon-link" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell size={20} />{unread > 0 && <span>{unread}</span>}
            </Link>
            <Link to="/post-ad" className="btn btn-primary seller-post-ad" aria-label="Post a new advertisement"><Plus size={17} /><span className="seller-post-ad-label">Post new ad</span></Link>
          </div>
        </header>
        {toast && <div className="notice success dashboard-toast" role="status">{toast}<button type="button" onClick={() => setToast('')} aria-label="Dismiss"><X size={15} /></button></div>}
        {unreadError && <div className="notice error dashboard-toast" role="alert">{unreadError}</div>}
        {location.pathname === '/dashboard' && <Overview setToast={setToast} />}
        {location.pathname === '/dashboard/ads' && <AdvertisementManagement setToast={setToast} />}
        {location.pathname === '/dashboard/promotions' && <PromotionManagement setToast={setToast} />}
        {isAnalyticsPath && <Analytics />}
        {location.pathname === '/dashboard/verification' && <Verification setToast={setToast} />}
        {location.pathname === '/dashboard/notifications' && <Notifications setUnread={setUnread} />}
      </main>
    </div>
  );
}

function Overview({ setToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getSellerDashboard()
      .then(({ data: result }) => active && setData(result))
      .catch((requestError) => active && setError(messageFrom(requestError, 'Unable to load your seller dashboard.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const stats = data?.stats || {};
  const cards = [
    { label: 'Total advertisements', value: stats.totalAdvertisements, icon: FolderOpen },
    { label: 'Active', value: stats.activeAdvertisements, icon: CheckCircle2 },
    { label: 'Pending review', value: stats.pendingAdvertisements, icon: TimerReset },
    { label: 'Rejected', value: stats.rejectedAdvertisements, icon: XCircle },
    { label: 'Product views', value: stats.totalProductViews, icon: Eye },
    { label: 'Buyer enquiries', value: stats.totalEnquiries, icon: MessageSquareText },
  ];

  if (loading) return <div className="dashboard-loading"><div className="stats-grid">{cards.map(({ label }) => <div className="stat-card skeleton" key={label} />)}</div><div className="panel loading-card">Loading live seller data...</div></div>;
  return <>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="stats-grid seller-stats-grid">
      {cards.map(({ label, value = 0, icon }) => <StatCard key={label} label={label} value={value} Icon={icon} />)}
    </section>
    <div className="dashboard-content-grid">
      <section className="panel dashboard-panel">
        <div className="panel-header"><div><h2>Recent advertisements</h2><p className="muted">Your latest listings and review status</p></div><Link className="link" to="/dashboard/ads">Manage all</Link></div>
        {!data?.recentAdvertisements?.length ? <div className="empty small">No advertisements yet. Post your first product to get started.</div> : <div className="table-wrap">
          <table><thead><tr><th>Advertisement</th><th>Status</th><th>Views</th><th>Enquiries</th><th /></tr></thead><tbody>
            {data.recentAdvertisements.map((ad) => <tr key={ad.id}>
              <td><div className="seller-ad-title">{ad.images?.[0] && <img src={resolveImageUrl(ad.images[0])} alt="" />}<span>{ad.title}<small>{formatNaira(ad.price)}</small></span></div></td>
              <td><StatusBadge status={ad.status} /></td><td>{Number(ad.views || 0).toLocaleString()}</td><td>{ad.enquiries || 0}</td>
              <td><Link className="link" to={`/dashboard/ads/${ad.id}/edit`}>Edit</Link></td>
            </tr>)}
          </tbody></table>
        </div>}
      </section>
      <section className="panel dashboard-panel">
        <div className="panel-header"><div><h2>Recent enquiries</h2><p className="muted">Messages received from buyers</p></div><Link className="link" to="/messages">View messages</Link></div>
        {!data?.recentEnquiries?.length ? <div className="empty small">No buyer enquiries yet.</div> : <div className="seller-enquiry-list">
          {data.recentEnquiries.map((item) => <article key={item.id}><span className="enquiry-avatar">{item.sender_name?.[0] || 'B'}</span><div><strong>{item.sender_name}</strong><p>{item.message}</p><Link to={`/ads/${item.advertisement_id}`}>{item.advertisement_title}</Link></div><time>{new Date(item.created_at).toLocaleDateString('en-NG')}</time></article>)}
        </div>}
      </section>
      <section className="panel dashboard-panel">
        <div className="panel-header"><div><h2>Top viewed products</h2><p className="muted">Ranked using real listing view counts</p></div><Link className="link" to="/dashboard/analytics">Analytics</Link></div>
        {!data?.topAdvertisements?.length ? <div className="empty small">Product performance will appear here.</div> : <div className="seller-top-list">
          {data.topAdvertisements.map((ad) => <div key={ad.id}><Link to={`/dashboard/ads/${ad.id}/edit`}>{ad.title}</Link><span><Eye size={14} /> {Number(ad.views).toLocaleString()}</span></div>)}
        </div>}
      </section>
      <section className="panel dashboard-panel quick-actions">
        <h2>Quick actions</h2>
        <Link to="/post-ad" className="quick-action"><Plus size={18} /> Post an advertisement</Link>
        <Link to="/dashboard/verification" className="quick-action"><ShieldCheck size={18} /> Request seller verification</Link>
        <Link to="/dashboard/analytics" className="quick-action"><BarChart3 size={18} /> Review performance</Link>
      </section>
    </div>
  </>;
}

function StatCard({ label, value, Icon }) {
  return <div className="stat-card"><div className="stat-icon"><Icon size={19} /></div><div><p>{label}</p><strong>{Number(value || 0).toLocaleString()}</strong></div></div>;
}

function StatusBadge({ status }) {
  const labels = {
    approved: 'Active',
    pending: 'Pending',
    rejected: 'Rejected',
    paused: 'Paused',
    suspended: 'Suspended',
    changes_requested: 'Changes requested',
    sold: 'Sold',
    expired: 'Expired',
  };
  const label = labels[status] || String(status || 'Unknown').replaceAll('_', ' ');
  return <span className={`status status-${status}`}>{label}</span>;
}

function AdvertisementManagement({ setToast }) {
  const [ads, setAds] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [filters, setFilters] = useState({ q: '', status: '', sort: 'newest', page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = { page: filters.page, limit: 20, sort: filters.sort };
    const search = filters.q.trim();
    if (search) params.q = search;
    if (filters.status) params.status = filters.status;
    setLoading(true);
    setError('');
    getSellerAds(params, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        setAds(data.advertisements || []);
        setPagination(data.pagination || { page: filters.page, pages: 0, total: 0 });
      })
      .catch((requestError) => {
        if (active && requestError.code !== 'ERR_CANCELED') {
          setError(messageFrom(requestError, 'Unable to load your advertisements. Please try again.'));
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, reload]);

  const remove = async (ad) => {
    if (!window.confirm(`Delete “${ad.title}”? This cannot be undone.`)) return;
    setWorkingId(ad.id);
    try {
      await deleteAd(ad.id);
      setAds((current) => current.filter((item) => item.id !== ad.id));
      setPagination((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
      if (ads.length === 1 && filters.page > 1) {
        setFilters((current) => ({ ...current, page: current.page - 1 }));
      } else {
        setReload((current) => current + 1);
      }
      setToast('Advertisement deleted.');
    } catch (requestError) { setError(messageFrom(requestError, 'Unable to delete this advertisement. Please try again.')); }
    finally { setWorkingId(null); }
  };

  const statusAction = async (ad, status) => {
    setWorkingId(ad.id);
    setError('');
    try {
      await updateSellerAdStatus(ad.id, status);
      setToast(status === 'paused' ? 'Advertisement paused.' : status === 'sold' ? 'Advertisement marked as sold.' : 'Advertisement reactivated.');
      setReload((current) => current + 1);
    } catch (requestError) { setError(messageFrom(requestError, 'Could not update that advertisement.')); }
    finally { setWorkingId(null); }
  };

  const duplicate = async (ad) => {
    setWorkingId(ad.id);
    try {
      const { data } = await duplicateSellerAd(ad.id);
      setToast(data.message);
      setFilters((current) => ({ ...current, page: 1 }));
      setReload((current) => current + 1);
    } catch (requestError) { setError(messageFrom(requestError, 'Could not duplicate that advertisement.')); }
    finally { setWorkingId(null); }
  };

  return <section className="panel dashboard-panel">
    <div className="seller-listing-toolbar">
      <label className="seller-search"><Search size={17} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value, page: 1 }))} placeholder="Search your advertisements" /></label>
      <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value, page: 1 }))}>
        <option value="">All statuses</option><option value="approved">Active</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="paused">Paused</option><option value="suspended">Suspended</option><option value="changes_requested">Changes requested</option><option value="sold">Sold</option><option value="expired">Expired</option>
      </select>
      <select aria-label="Sort advertisements" value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="views">Most viewed</option><option value="price_asc">Lowest price</option><option value="price_desc">Highest price</option>
      </select>
      <Link to="/post-ad" className="btn btn-primary"><Plus size={16} /> New ad</Link>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!loading && !error && <p className="seller-ad-count">{pagination.total.toLocaleString()} advertisement{pagination.total === 1 ? '' : 's'}</p>}
    {loading ? <div className="seller-ads-skeleton" aria-label="Loading advertisements">{[1, 2, 3, 4].map((item) => <div key={item} className="seller-ad-skeleton-row skeleton" />)}</div>
      : !ads.length ? !error && <div className="empty small">{filters.q || filters.status ? 'No advertisements match these filters.' : 'You have not posted any advertisements yet. Post your first product to get started.'}</div>
        : <div className="table-wrap seller-ads-table">
      <table><thead><tr><th>Product</th><th>Category</th><th>Location</th><th>Status</th><th>Views</th><th>Enquiries</th><th>Date posted</th><th>Actions</th></tr></thead><tbody>
        {ads.map((ad) => <tr key={ad.id}>
          <td><div className="seller-ad-title">{ad.images?.[0] ? <img src={resolveImageUrl(ad.images[0])} alt="" /> : <span className="seller-ad-placeholder"><FolderOpen size={20} /></span>}<span>{ad.title}<small>{formatNaira(ad.price)}</small></span></div></td>
          <td>{ad.category?.name || ad.category_name || '—'}</td>
          <td>{[ad.city, ad.state].filter(Boolean).join(', ') || '—'}</td>
          <td><StatusBadge status={ad.status} /></td><td>{Number(ad.views || 0).toLocaleString()}</td><td>{Number(ad.enquiries || 0).toLocaleString()}</td><td>{new Date(ad.created_at).toLocaleDateString('en-NG')}</td>
          <td><div className="seller-row-actions">
            <Link title="Edit advertisement" to={`/dashboard/ads/${ad.id}/edit`}><Pencil size={16} /></Link>
            {ad.status === 'approved' && <button title="Pause advertisement" disabled={workingId === ad.id} onClick={() => statusAction(ad, 'paused')}><Pause size={16} /></button>}
            {ad.status === 'paused' && <button title="Reactivate advertisement" disabled={workingId === ad.id} onClick={() => statusAction(ad, 'approved')}><Play size={16} /></button>}
            {['approved', 'paused'].includes(ad.status) && <button title="Mark as sold" disabled={workingId === ad.id} onClick={() => statusAction(ad, 'sold')}><CheckCircle2 size={16} /></button>}
            {ad.status === 'sold' && <button title="Mark as available" disabled={workingId === ad.id} onClick={() => statusAction(ad, 'approved')}><Play size={16} /></button>}
            <button title="Duplicate advertisement" disabled={workingId === ad.id} onClick={() => duplicate(ad)}><Copy size={16} /></button>
            {ad.status === 'approved' && <Link title="View product" to={`/ads/${ad.id}`}><ExternalLink size={16} /></Link>}
            {['pending', 'approved'].includes(ad.status) && <Link title="Promote advertisement" to="/dashboard/promotions"><Megaphone size={16} /></Link>}
            <button title="Delete advertisement" disabled={workingId === ad.id} onClick={() => remove(ad)}><Trash2 size={16} /></button>
          </div></td>
        </tr>)}
      </tbody></table>
    </div>}
    {!loading && pagination.pages > 1 && <div className="pagination"><button className="btn btn-white" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {pagination.page} of {pagination.pages} · {pagination.total} ads</span><button className="btn btn-white" disabled={filters.page >= pagination.pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></div>}
  </section>;
}

function PromotionManagement({ setToast }) {
  const [packages, setPackages] = useState([]);
  const [listings, setListings] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [selectedAd, setSelectedAd] = useState('');
  const [selectedPackage, setSelectedPackage] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [paymentRetry, setPaymentRetry] = useState(0);
  const [checkingPayment, setCheckingPayment] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getPromotionPackages(),
      getMyPromotions(),
      getSellerAds({ limit: 50 }),
    ]).then(([packageResult, promotionResult, adsResult]) => {
      if (!active) return;
      const errors = [];
      if (packageResult.status === 'fulfilled') {
        const available = (packageResult.value.data?.packages || [])
          .filter((item) => item.is_active === true || Number(item.is_active) === 1);
        setPackages(available);
        if (available.length) setSelectedPackage(String(available[0].id));
      } else {
        errors.push(messageFrom(packageResult.reason, 'Promotion packages could not be loaded.'));
      }
      if (promotionResult.status === 'fulfilled') {
        setPromotions(promotionResult.value.data?.promotions || []);
      } else {
        errors.push(messageFrom(promotionResult.reason, 'Your promotion history could not be loaded.'));
      }
      if (adsResult.status === 'fulfilled') {
        const eligibleAds = (adsResult.value.data?.advertisements || [])
          .filter((ad) => ['pending', 'approved'].includes(ad.status));
        setListings(eligibleAds);
        if (eligibleAds.length) setSelectedAd(String(eligibleAds[0].id));
      } else {
        errors.push(messageFrom(adsResult.reason, 'Your eligible advertisements could not be loaded.'));
      }
      setError(errors.join(' '));
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const reference = searchParams.get('payment_reference');
    if (!reference) return undefined;
    let active = true;
    let settled = false;
    setCheckingPayment(true);
    setCheckoutMessage(searchParams.get('checkout_cancelled') === '1'
      ? 'Checkout was closed before confirmation. Payment status is being checked with Bachs.'
      : 'Checking your payment status with Bachs...');
    setError('');
    verifyPromotion(reference)
      .then(async ({ data }) => {
        if (!active) return;
        if (data.status === 'succeeded') {
          settled = true;
          setCheckoutMessage('Bachs confirmed your payment. Your promotion status has been updated.');
          const { data: promotionData } = await getMyPromotions();
          if (active) setPromotions(promotionData.promotions || []);
        } else if (data.status === 'failed') {
          settled = true;
          setCheckoutMessage(data.message || 'This checkout expired before payment was confirmed.');
        } else {
          setCheckoutMessage('Payment is still processing. Promotions activate only after Bachs confirms payment.');
        }
      })
      .catch((requestError) => {
        if (active) setError(messageFrom(requestError, 'Payment status could not be verified. Please refresh shortly.'));
      })
      .finally(() => {
        if (active) setCheckingPayment(false);
        if (active && settled) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('payment_reference');
          nextParams.delete('checkout_cancelled');
          setSearchParams(nextParams, { replace: true });
        }
      });
    return () => { active = false; };
  }, [searchParams, setSearchParams, paymentRetry]);

  const submitPromotion = async () => {
    if (!selectedAd || !selectedPackage) return;
    const packageInfo = packages.find((item) => String(item.id) === String(selectedPackage));
    const advertisement = listings.find((item) => String(item.id) === String(selectedAd));
    if (!packageInfo || !advertisement) {
      setError('Choose an eligible advertisement and an available package before continuing.');
      return;
    }
    setSubmitting(true);
    setError('');
    setCheckoutMessage('');
    try {
      const { data } = await initializePromotion({
        advertisementId: Number(selectedAd),
        packageId: Number(selectedPackage),
      });
      window.location.assign(data.authorizationUrl);
      setToast('Continue securely on Bachs to complete your promotion payment.');
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not start Bachs checkout. Check your selections and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedListing = listings.find((item) => String(item.id) === String(selectedAd));
  const selectedPackageInfo = packages.find((item) => String(item.id) === String(selectedPackage));

  return <section className="panel dashboard-panel promotion-panel">
    <div className="panel-header"><div><h2>Promote Your Products</h2><p className="muted">Increase visibility with a paid marketplace placement.</p></div></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {checkoutMessage && <div className={`notice ${checkoutMessage.startsWith('Bachs confirmed') ? 'success' : 'promotion-notice'}`} role="status">{checkoutMessage}</div>}
    {searchParams.get('payment_reference') && <button type="button" className="btn btn-white" disabled={checkingPayment} onClick={() => setPaymentRetry((value) => value + 1)}>{checkingPayment ? 'Checking payment...' : 'Check payment status again'}</button>}
    {loading ? <div className="loading-card" role="status">Loading promotion options...</div> : (
      <>
        <div className="promotion-grid">
          <div className="promotion-form panel mini-panel">
            <label className="field"><span>Choose advertisement</span><select value={selectedAd} onChange={(event) => setSelectedAd(event.target.value)} disabled={!listings.length}><option value="">Select an eligible advertisement</option>{listings.map((ad) => <option key={ad.id} value={ad.id}>{ad.title}</option>)}</select></label>
            {!listings.length && <div className="empty small">You have no eligible advertisements. Only pending or approved ads can be promoted.</div>}
            {selectedListing && <div className="promotion-ad-preview">
              {selectedListing.images?.[0]
                ? <img src={resolveImageUrl(selectedListing.images[0])} alt="" />
                : <div className="promotion-ad-placeholder" aria-hidden="true"><Megaphone size={22} /></div>}
              <div><strong>{selectedListing.title}</strong><small>{selectedListing.status === 'pending' ? 'Pending review' : 'Approved'}</small></div>
            </div>}
            {packages.length === 0
              ? <div className="empty small">No active promotion packages are available right now. Please check back later.</div>
              : <div className="promotion-package-options" role="group" aria-label="Select a promotion package">
                {packages.map((item) => (
                  <button type="button" key={item.id} aria-pressed={selectedPackage === String(item.id)}
                    className={`promotion-package ${selectedPackage === String(item.id) ? 'selected' : ''}`}
                    onClick={() => setSelectedPackage(String(item.id))}>
                    <span className="promotion-package-header"><strong>{item.name}</strong><span>{item.duration_days} days</span></span>
                    <span className="promotion-package-price">{formatNaira(item.price)}</span>
                    <span className="promotion-package-description">{item.description || 'Boost visibility for your listing.'}</span>
                    {item.benefits && <span className="promotion-package-benefits">{item.benefits}</span>}
                  </button>
                ))}
              </div>}
            {selectedListing && selectedPackageInfo && (
              <div className="promotion-summary">
                <div><small>Advertisement</small><strong>{selectedListing.title}</strong></div>
                <div><small>Package</small><strong>{selectedPackageInfo.name}</strong></div>
                <div><small>Duration</small><strong>{selectedPackageInfo.duration_days} days</strong></div>
                <div><small>Total</small><strong>{formatNaira(selectedPackageInfo.price)}</strong></div>
              </div>
            )}
            <p className="promotion-checkout-note">Payment is securely processed by Bachs. Your promotion activates only after payment is confirmed.</p>
            <button type="button" className="btn btn-primary" disabled={!selectedAd || !selectedPackage || !packages.length || submitting} onClick={submitPromotion}>{submitting ? 'Preparing secure checkout...' : 'Continue to Bachs checkout'}</button>
          </div>
        </div>
        <div className="promotion-listings">
          <h3>My promotions</h3>
          {!promotions.length ? <div className="empty small">You do not have any promotions yet.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Advertisement</th><th>Package</th><th>Amount paid</th><th>Start date</th><th>Expiry date</th><th>Promotion status</th><th>Payment status</th></tr></thead><tbody>{promotions.map((promotion) => (
              <tr key={promotion.id}>
                <td>{promotion.advertisement_title || `Advertisement #${promotion.advertisement_id}`}</td>
                <td>{promotion.package_name} · {promotion.duration_days} days</td>
                <td>{promotion.payment_status === 'succeeded' ? formatNaira(promotion.amount) : '—'}</td>
                <td>{promotion.starts_at ? new Date(promotion.starts_at).toLocaleDateString('en-NG') : '—'}</td>
                <td>{promotion.expires_at ? new Date(promotion.expires_at).toLocaleDateString('en-NG') : '—'}</td>
                <td><span className={`status status-${promotion.promotion_status || 'pending'}`}>{(promotion.promotion_status || 'pending').replaceAll('_', ' ')}</span></td>
                <td><span className={`status status-${promotion.payment_status || 'pending'}`}>{promotion.payment_status || 'pending'}</span></td>
              </tr>
            ))}</tbody></table></div>
          )}
        </div>
      </>
    )}
  </section>;
}

function Analytics() {
  const { advertisementId } = useParams();
  const [range, setRange] = useState('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedAd, setSelectedAd] = useState(advertisementId || '');
  const [ads, setAds] = useState([]);
  const [adsError, setAdsError] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dateParams = useMemo(() => {
    if (range === 'custom') {
      return customFrom && customTo
        ? { days: 365, from: customFrom, to: customTo }
        : null;
    }
    if (range === 'year') {
      const today = new Date();
      const year = today.getFullYear();
      const to = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      return { days: 365, from: `${year}-01-01`, to };
    }
    return { days: Number(range) };
  }, [range, customFrom, customTo]);

  useEffect(() => {
    let active = true;
    getSellerAds({ limit: 50 })
      .then(({ data }) => active && setAds(data.advertisements || []))
      .catch((requestError) => {
        if (active) setAdsError(messageFrom(requestError, 'Your advertisements could not be loaded.'));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!dateParams) {
      setLoading(false);
      setError('Choose both a start date and an end date to view a custom range.');
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    setAnalytics(null);
    const request = selectedAd
      ? getAdvertisementAnalytics(selectedAd, dateParams)
      : getSellerAnalytics(dateParams);
    request.then(({ data }) => active && setAnalytics(data))
      .catch((requestError) => active && setError(messageFrom(requestError, 'Unable to load analytics data. Please refresh the page.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateParams, selectedAd]);

  const chartData = useMemo(() => {
    if (!analytics?.range) return [];
    const views = new Map(analytics.trackedViews.map((item) => [item.date, item.views]));
    const enquiries = new Map(analytics.enquiries.map((item) => [item.date, item.enquiries]));
    const start = new Date(`${analytics.range.from}T00:00:00Z`);
    const end = new Date(`${analytics.range.to}T00:00:00Z`);
    const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        label: date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        views: views.get(key) || 0,
        enquiries: enquiries.get(key) || 0,
      };
    });
  }, [analytics]);

  const enquiriesInRange = analytics?.enquiries.reduce((sum, item) => sum + item.enquiries, 0) || 0;
  const viewsInRange = analytics?.trackedViews.reduce((sum, item) => sum + item.views, 0) || 0;

  return <>
    <section className="panel analytics-toolbar">
      <div><h2>Performance overview</h2><p className="muted">All metrics come from marketplace views and buyer enquiries.</p></div>
      <div className="seller-analytics-controls">
        <label><span>Product</span><select value={selectedAd} onChange={(event) => setSelectedAd(event.target.value)}><option value="">All advertisements</option>{ads.map((ad) => <option key={ad.id} value={ad.id}>{ad.title}</option>)}</select></label>
        <label><span>Date range</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="year">This year</option><option value="custom">Custom range</option></select></label>
        {range === 'custom' && <div className="seller-custom-date-range">
          <label><span>From</span><input aria-label="Analytics start date" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
          <label><span>To</span><input aria-label="Analytics end date" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
        </div>}
      </div>
    </section>
    {adsError && <div className="notice error" role="alert">{adsError}</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {loading && <div className="stats-grid analytics-summary" aria-label="Loading analytics">{[1, 2, 3, 4, 5, 6, 7, 8].map((item) => <div key={item} className="stat-card skeleton" />)}</div>}
    {!loading && analytics && <div className="stats-grid analytics-summary">
      <StatCard label="Total advertisements" value={analytics.totalAdvertisements} Icon={FolderOpen} />
      <StatCard label="Active advertisements" value={analytics.activeAdvertisements} Icon={CheckCircle2} />
      <StatCard label="Pending review" value={analytics.pendingAdvertisements} Icon={TimerReset} />
      <StatCard label="Total views" value={analytics.totalViews} Icon={Eye} />
      <StatCard label="Views in range" value={viewsInRange} Icon={BarChart3} />
      <StatCard label="Total enquiries" value={analytics.totalEnquiries} Icon={MessageSquareText} />
      <StatCard label="Enquiries in range" value={enquiriesInRange} Icon={MessageSquareText} />
      <StatCard label="Favourites" value={analytics.totalFavourites} Icon={Heart} />
    </div>}
    {!loading && analytics && <>
      <p className="analytics-history-note"><CircleHelp size={15} /> {analytics.historyNote}</p>
      <p className="analytics-period-total">{viewsInRange.toLocaleString()} tracked views and {enquiriesInRange.toLocaleString()} enquiries from {analytics.range.from} to {analytics.range.to}.</p>
      <section className="seller-chart-grid">
        <MetricChart title="Daily product views" metric="views" data={chartData} color="#1264D8" />
        <MetricChart title="Buyer enquiries over time" metric="enquiries" data={chartData} color="#16A34A" />
      </section>
      <StatusDistribution data={analytics.statusDistribution} />
      <section className="panel dashboard-panel">
        <div className="panel-header"><div><h2>Advertisement performance</h2><p className="muted">Ranked by cumulative views, then enquiries.</p></div></div>
        {!analytics.topAdvertisements.length ? <div className="empty small">You have not posted any advertisements yet.</div> : <div className="table-wrap"><table><thead><tr><th>Advertisement</th><th>Status</th><th>Views</th><th>Enquiries</th><th>Favourites</th><th>Category</th><th>Date posted</th></tr></thead><tbody>{analytics.topAdvertisements.map((ad) => <tr key={ad.id}><td><Link className="link" to={`/dashboard/ads/${ad.id}/edit`}>{ad.title}</Link><small className="analytics-ad-location">{[ad.city, ad.state].filter(Boolean).join(', ')}</small></td><td><StatusBadge status={ad.status} /></td><td>{ad.views.toLocaleString()}</td><td>{ad.enquiries.toLocaleString()}</td><td>{ad.favourites.toLocaleString()}</td><td>{ad.category_name}</td><td>{new Date(ad.created_at).toLocaleDateString('en-NG')}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </>;
}

function StatusDistribution({ data }) {
  const statusLabels = {
    approved: 'Active',
    pending: 'Pending',
    rejected: 'Rejected',
    paused: 'Paused',
    suspended: 'Suspended',
    changes_requested: 'Changes requested',
    sold: 'Sold',
    expired: 'Expired',
  };
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <section className="panel status-distribution">
    <div className="panel-header"><div><h2>Advertisement status</h2><p className="muted">Your listings by their current review and availability status.</p></div></div>
    {!total ? <div className="empty small">Status distribution will appear after you post an advertisement.</div> : <div className="status-distribution-list">
      {data.map((item) => (
        <div className="status-distribution-row" key={item.status}>
          <span>{statusLabels[item.status] || item.status.replaceAll('_', ' ')}</span>
          <div className="status-distribution-track"><i style={{ width: `${(item.count / total) * 100}%` }} /></div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>}
  </section>;
}

function MetricChart({ title, metric, data, color }) {
  const width = 720;
  const height = 220;
  const max = Math.max(1, ...data.map((item) => item[metric]));
  const points = data.map((item, index) => `${data.length <= 1 ? width / 2 : (index / (data.length - 1)) * width},${height - (item[metric] / max) * (height - 24)}`).join(' ');
  const total = data.reduce((sum, item) => sum + item[metric], 0);
  return <section className="panel metric-chart">
    <div className="panel-header"><div><h2>{title}</h2><p className="muted">{total.toLocaleString()} recorded in selected period</p></div><span className="chart-legend" style={{ '--series-color': color }}><i /> {metric === 'views' ? 'Views' : 'Enquiries'}</span></div>
    {!total ? <div className="empty small">No tracked {metric} in this period yet.</div> : <div className="chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none">
        {[0, 1, 2, 3].map((line) => <line key={line} x1="0" x2={width} y1={line * (height / 3)} y2={line * (height / 3)} className="chart-gridline" />)}
        <polyline points={points} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>{data[0]?.label}</span><span>{data[Math.floor(data.length / 2)]?.label}</span><span>{data.at(-1)?.label}</span></div>
    </div>}
  </section>;
}

function Verification({ setToast }) {
  const [verification, setVerification] = useState(null);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    verificationType: 'registered_business', businessName: '', businessOwner: '', businessEmail: '',
    businessPhone: '', whatsapp: '', businessAddress: '', state: '', city: '',
    businessDescription: '', website: '', businessCategoryId: '', registrationNumber: '',
  });
  const [documents, setDocuments] = useState({ cacDocument: null, identityDocument: null, additionalDocument: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([getSellerVerification(), getCategories()])
      .then(([verificationResult, categoryResult]) => {
        if (!active) return;
        const saved = verificationResult.data.verification;
        setVerification(saved);
        setCategories(categoryResult || []);
        if (saved) {
          setForm({
            verificationType: saved.verification_type || 'registered_business',
            businessName: saved.business_name || '',
            businessOwner: saved.business_owner || '',
            businessEmail: saved.business_email || '',
            businessPhone: saved.business_phone || '',
            whatsapp: saved.whatsapp || '',
            businessAddress: saved.business_address || '',
            state: saved.state || '',
            city: saved.city || '',
            businessDescription: saved.business_description || '',
            website: saved.website || '',
            businessCategoryId: saved.business_category_id ? String(saved.business_category_id) : '',
            registrationNumber: saved.registration_number || '',
          });
        }
      })
      .catch((requestError) => active && setError(messageFrom(requestError, 'Could not load verification information.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const pickDocument = async (event, key) => {
    const input = event.target;
    const selected = input.files?.[0] || null;
    const { file, error: problem } = await prepareDocument(selected);
    if (problem) {
      input.value = '';
      setError(problem);
      setDocuments((current) => ({ ...current, [key]: null }));
      return;
    }
    setError('');
    setDocuments((current) => ({ ...current, [key]: file }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!documents.identityDocument && !verification?.has_identity_document && !documents.cacDocument && !documents.additionalDocument) {
      setError('Attach at least one PDF, PNG, JPEG or iPhone HEIC verification document.');
      return;
    }
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    Object.entries(documents).forEach(([key, file]) => { if (file) payload.append(key, file); });
    setSaving(true);
    setError('');
    try {
      const request = verification?.status === 'information_requested'
        ? updateSellerVerification(payload)
        : submitSellerVerification(payload);
      const { data } = await request;
      setVerification(data.verification);
      setDocuments({ cacDocument: null, identityDocument: null, additionalDocument: null });
      setToast(data.message);
    } catch (requestError) { setError(messageFrom(requestError, 'Could not submit verification.')); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="panel loading-card">Loading verification status...</div>;
  return <div className="verification-page">
    <section className="panel verification-status-card">
      <div className="verification-icon"><ShieldCheck size={24} /></div>
      <div><p className="eyebrow">Seller trust</p><h2>{verification ? ({
        pending: 'Pending Review', verified: 'Verified', rejected: 'Rejected',
        information_requested: 'Information Requested', revoked: 'Not Verified',
      }[verification.status] || 'Not Verified') : 'Not Verified'}</h2><p className="muted">{verification?.status === 'pending'
        ? 'Your application is securely stored and awaiting administrator review.'
        : verification?.status === 'verified'
          ? 'Your business verification is approved. The verified badge is displayed only while this status remains approved.'
          : verification?.status === 'information_requested'
            ? 'An administrator needs additional details. Update your application and resubmit it for review.'
            : verification?.status === 'rejected'
              ? 'Your application was not approved. Review the administrator feedback and submit a corrected application.'
              : verification?.status === 'revoked'
                ? 'Your business verification is no longer active.'
                : 'Submit your business information and supporting documents for review.'}</p>{verification?.submitted_at && <small>Submitted {new Date(verification.submitted_at).toLocaleDateString('en-NG')}</small>}</div>
      {verification && <StatusBadge status={verification.status} />}
    </section>
    {error && <div className="notice error" role="alert">{error}</div>}
    {verification?.admin_notes && (verification.status === 'information_requested' || verification.status === 'rejected' || verification.status === 'revoked') && <div className={`notice ${verification.status === 'rejected' ? 'error' : 'success'}`} role="status"><strong>Administrator feedback:</strong> {verification.rejection_reason || verification.admin_notes}</div>}
    {verification?.status !== 'pending' && verification?.status !== 'verified' && verification?.status !== 'revoked' && <section className="panel">
      <div className="panel-header"><div><h2>Submit verification details</h2><p className="muted">Documents are private and accessible only to authorized administrators.</p></div></div>
      <form className="verification-form" onSubmit={submit}>
        <label className="field"><span>Verification type *</span><select name="verificationType" value={form.verificationType} onChange={update}><option value="registered_business">Registered business</option><option value="renewable_energy_company">Renewable energy company</option><option value="individual">Individual seller</option></select></label>
        <label className="field"><span>Business name *</span><input name="businessName" required minLength="2" maxLength="160" value={form.businessName} onChange={update} /></label>
        <label className="field"><span>Business owner *</span><input name="businessOwner" required minLength="2" maxLength="120" value={form.businessOwner} onChange={update} /></label>
        <label className="field"><span>Business email</span><input name="businessEmail" type="email" maxLength="254" value={form.businessEmail} onChange={update} /></label>
        <label className="field"><span>Business phone *</span><input name="businessPhone" type="tel" required minLength="8" value={form.businessPhone} onChange={update} /></label>
        <label className="field"><span>WhatsApp number</span><input name="whatsapp" type="tel" value={form.whatsapp} onChange={update} /></label>
        <label className="field"><span>Business address *</span><input name="businessAddress" required minLength="5" maxLength="255" value={form.businessAddress} onChange={update} /></label>
        <label className="field"><span>State</span><select name="state" value={form.state} onChange={update}><option value="">Select state</option>{NIGERIAN_STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
        <label className="field"><span>City</span><input name="city" maxLength="120" value={form.city} onChange={update} /></label>
        <label className="field"><span>Business category</span><select name="businessCategoryId" value={form.businessCategoryId} onChange={update}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="field"><span>CAC registration number</span><input name="registrationNumber" maxLength="100" value={form.registrationNumber} onChange={update} /></label>
        <label className="field"><span>Business website</span><input name="website" type="url" maxLength="2048" placeholder="https://" value={form.website} onChange={update} /></label>
        <label className="field verification-description-field"><span>Business description</span><textarea name="businessDescription" rows="3" maxLength="5000" value={form.businessDescription} onChange={update} /></label>
        <label className="field verification-file-field"><span>CAC certificate <small>PDF, PNG, JPEG or iPhone HEIC · maximum 5 MB</small></span><input type="file" accept={DOCUMENT_ACCEPT} onChange={(event) => pickDocument(event, 'cacDocument')} /></label>
        <label className="field verification-file-field"><span>Business identity / supporting document {verification?.has_identity_document ? '' : '*'} <small>PDF, PNG, JPEG or iPhone HEIC · maximum 5 MB</small></span><input type="file" required={!verification?.has_identity_document} accept={DOCUMENT_ACCEPT} onChange={(event) => pickDocument(event, 'identityDocument')} /></label>
        <label className="field verification-file-field"><span>Additional supporting document <small>PDF, PNG, JPEG or iPhone HEIC · maximum 5 MB</small></span><input type="file" accept={DOCUMENT_ACCEPT} onChange={(event) => pickDocument(event, 'additionalDocument')} /></label>
        <div className="verification-submit"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Submitting...' : 'Submit for review'}</button></div>
      </form>
    </section>}
  </div>;
}

function Notifications({ setUnread }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getSellerNotifications().then(({ data }) => {
      if (!active) return;
      setNotifications(data.notifications);
      setUnread(data.notifications.filter((item) => !item.is_read).length);
    }).catch((requestError) => active && setError(messageFrom(requestError, 'Could not load notifications.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [setUnread]);
  const markRead = async (item) => {
    try {
      await markSellerNotificationRead(item.id);
      setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, is_read: 1 } : notification));
      setUnread((count) => Math.max(0, count - 1));
    } catch (requestError) { setError(messageFrom(requestError, 'Could not update the notification.')); }
  };
  return <section className="panel dashboard-panel">
    {error && <div className="notice error" role="alert">{error}</div>}
    {loading ? <div className="loading-card">Loading notifications...</div> : !notifications.length ? <div className="empty small"><Bell size={28} /><p>You’re all caught up. New account activity will appear here.</p></div> : <div className="seller-notification-list">{notifications.map((item) => <article className={!item.is_read ? 'unread' : ''} key={item.id}>
      <span className="notification-dot" /><div><strong>{item.title}</strong><p>{item.body}</p><time>{new Date(item.created_at).toLocaleString('en-NG')}</time></div>
      {item.related_advertisement_id && <Link className="link" to={`/ads/${item.related_advertisement_id}`}>View</Link>}
      {!item.is_read && <button className="btn btn-white" onClick={() => markRead(item)}>Mark read</button>}
    </article>)}</div>}
  </section>;
}
