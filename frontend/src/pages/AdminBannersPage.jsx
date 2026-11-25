import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  BANNER_SIZE, approveAdminBanner, deleteAdminBanner, getAdminBannerImage, getAdminBannerSettings, getAdminBanners,
  rejectAdminBanner, saveAdminBanner, saveAdminBannerSettings,
} from '../services/bannerService.js';
import { formatNaira } from '../utils/format.js';

const emptyForm = { title: '', advertiser: '', linkUrl: '', altText: '', sortOrder: '0', isActive: true, startsAt: '', endsAt: '' };

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function messageFrom(error, fallback) {
  return error.response?.data?.message || fallback;
}

const STATUS_LABELS = {
  pending_payment: 'Waiting for payment',
  pending_review: 'Paid, needs review',
  active: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function statusLabel(banner) {
  if (banner.is_expired) return 'Finished (days used up)';
  if (banner.is_live) return 'Live';
  return STATUS_LABELS[banner.status] || banner.status;
}

function BannerPreview({ id, version }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    let url = '';
    getAdminBannerImage(id)
      .then(({ data }) => {
        if (!active) return;
        url = URL.createObjectURL(data);
        setSrc(url);
      })
      .catch(() => { if (active) setSrc(''); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [id, version]);
  return src ? <img src={src} alt="" /> : <div className="loading-card">Loading preview…</div>;
}

export default function AdminBannersPage() {
  const [banners, setBanners] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pricePerDay, setPricePerDay] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const fileInput = useRef(null);

  const load = () => getAdminBanners()
    .then(({ data }) => setBanners(data.banners || []))
    .catch((requestError) => setError(messageFrom(requestError, 'Could not load banners.')))
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    getAdminBannerSettings().then(({ data }) => setPricePerDay(String(data.pricePerDay))).catch(() => {});
  }, []);

  const savePrice = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSavingPrice(true);
    try {
      const { data } = await saveAdminBannerSettings(pricePerDay);
      setPricePerDay(String(data.pricePerDay));
      setNotice(`Banner price saved: ${formatNaira(Number(data.pricePerDay))} per day.`);
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not save the price.'));
    } finally {
      setSavingPrice(false);
    }
  };

  const approve = async (banner) => {
    setError('');
    try {
      const { data } = await approveAdminBanner(banner.id);
      setNotice(data.message);
      await load();
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not approve the banner.'));
    }
  };

  const reject = async (banner) => {
    const note = window.prompt(`Why can't "${banner.title}" be approved? The advertiser will see this.`);
    if (!note) return;
    setError('');
    try {
      const { data } = await rejectAdminBanner(banner.id, note.trim());
      setNotice(data.message);
      await load();
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not reject the banner.'));
    }
  };

  const reset = () => {
    setForm(emptyForm);
    setFile(null);
    setEditingId(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const edit = (banner) => {
    setForm({
      title: banner.title,
      advertiser: banner.advertiser || '',
      linkUrl: banner.link_url || '',
      altText: banner.alt_text || '',
      sortOrder: String(banner.sort_order),
      isActive: Boolean(banner.is_active),
      startsAt: toLocalInput(banner.starts_at),
      endsAt: toLocalInput(banner.ends_at),
    });
    setFile(null);
    setEditingId(banner.id);
    setError('');
    setNotice('');
  };

  const payload = (overrides = {}) => {
    const values = { ...form, ...overrides };
    const body = new FormData();
    body.append('title', values.title);
    body.append('advertiser', values.advertiser);
    body.append('linkUrl', values.linkUrl);
    body.append('altText', values.altText);
    body.append('sortOrder', values.sortOrder);
    body.append('isActive', String(values.isActive));
    body.append('startsAt', values.startsAt ? new Date(values.startsAt).toISOString() : '');
    body.append('endsAt', values.endsAt ? new Date(values.endsAt).toISOString() : '');
    return body;
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!editingId && !file) {
      setError(`Choose a banner image (${BANNER_SIZE.recommended} px).`);
      return;
    }
    const body = payload();
    if (file) body.append('image', file);
    setSaving(true);
    try {
      await saveAdminBanner(body, editingId);
      setNotice(editingId ? 'Banner updated.' : 'Banner added.');
      reset();
      await load();
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not save the banner. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (banner) => {
    setError('');
    const body = new FormData();
    body.append('title', banner.title);
    body.append('advertiser', banner.advertiser || '');
    body.append('linkUrl', banner.link_url || '');
    body.append('altText', banner.alt_text || '');
    body.append('sortOrder', String(banner.sort_order));
    body.append('isActive', String(!banner.is_active));
    body.append('startsAt', banner.starts_at || '');
    body.append('endsAt', banner.ends_at || '');
    try {
      await saveAdminBanner(body, banner.id);
      await load();
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not update the banner.'));
    }
  };

  const remove = async (banner) => {
    if (!window.confirm(`Delete the banner "${banner.title}"? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteAdminBanner(banner.id);
      if (editingId === banner.id) reset();
      setNotice('Banner deleted.');
      await load();
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not delete the banner.'));
    }
  };

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <p className="eyebrow">MARKETPLACE MANAGEMENT</p>
          <h1>Homepage banners</h1>
          <p className="muted">Banners rotate in a slideshow on the homepage, the same size as the “Sell your solar equipment” section.</p>
        </div>
      </header>
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice success" role="status">{notice}</div>}

      <form className="panel admin-banner-price" onSubmit={savePrice}>
        <label className="field">
          <span>Price per day for advertisers (NGN)</span>
          <input type="number" min="1" step="0.01" required value={pricePerDay} onChange={(event) => setPricePerDay(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={savingPrice || !pricePerDay}>Save price</button>
        <p className="muted">Advertisers pay this times the days they choose, at /advertise. Banners you add here are free.</p>
      </form>

      <div className="admin-banner-layout">
        <form className="panel admin-banner-form" onSubmit={submit}>
          <div className="panel-header">
            <h2>{editingId ? 'Edit banner' : 'Add banner'}</h2>
            {editingId && <button className="btn btn-ghost" type="button" onClick={reset}><X size={16} /> Cancel edit</button>}
          </div>
          <p className="admin-banner-size">
            Advertisers should send a <strong>{BANNER_SIZE.recommended} px</strong> PNG or JPEG (shown at {BANNER_SIZE.width} x {BANNER_SIZE.height}). Any size with the same shape, at least {BANNER_SIZE.width} px wide and under 1.5 MB, also works. Keep text away from the edges, because narrow screens crop the sides.
          </p>
          <label className="field"><span>Banner image {editingId && '(leave empty to keep the current one)'}</span>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          <label className="field"><span>Title</span><input value={form.title} minLength="2" maxLength="120" required onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="field"><span>Advertiser (optional)</span><input value={form.advertiser} maxLength="120" onChange={(event) => setForm({ ...form, advertiser: event.target.value })} /></label>
          <label className="field"><span>Link (optional)</span><input type="url" placeholder="https://" value={form.linkUrl} maxLength="2048" onChange={(event) => setForm({ ...form, linkUrl: event.target.value })} /></label>
          <label className="field"><span>Image description for screen readers (optional)</span><input value={form.altText} maxLength="200" onChange={(event) => setForm({ ...form, altText: event.target.value })} /></label>
          <label className="field"><span>Show from (optional)</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
          <label className="field"><span>Show until (optional)</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
          <label className="field"><span>Order (lower shows first)</span><input type="number" min="-1000" max="1000" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Visible on the homepage</label>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {editingId ? 'Save changes' : <><Plus size={16} /> Add banner</>}
          </button>
        </form>

        <div className="admin-banner-list">
          {loading && <div className="panel loading-card">Loading banners…</div>}
          {!loading && banners.length === 0 && <div className="panel"><p className="muted">No banners yet. Add the first one to start the slideshow.</p></div>}
          {banners.map((banner) => (
            <article className="panel admin-banner-item" key={banner.id}>
              <BannerPreview id={banner.id} version={banner.updated_at} />
              <div className="admin-banner-meta">
                <div>
                  <strong>{banner.title}</strong>
                  <p className="muted">
                    {banner.advertiser ? `${banner.advertiser} · ` : ''}
                    {banner.width} x {banner.height} · order {banner.sort_order}
                    {banner.is_active ? '' : ' · hidden'}
                  </p>
                  <p className="muted">
                    {statusLabel(banner)}
                    {banner.owner_name ? ` · by ${banner.owner_name} (${banner.owner_email})` : ' · added by admin'}
                    {banner.duration_days ? ` · ${banner.duration_days} days` : ''}
                    {banner.paid_amount ? ` · paid ${formatNaira(Number(banner.paid_amount))}` : ''}
                    {banner.ends_at ? ` · ends ${new Date(banner.ends_at).toLocaleDateString()}` : ''}
                  </p>
                  {banner.review_note && <p className="muted">Note: {banner.review_note}</p>}
                </div>
                <div className="admin-banner-actions">
                  {banner.status === 'pending_review' && (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => approve(banner)}><Check size={16} /> Approve</button>
                      <button type="button" className="btn btn-white" onClick={() => reject(banner)}><X size={16} /> Reject</button>
                    </>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => toggleActive(banner)} aria-label={banner.is_active ? 'Hide banner' : 'Show banner'}>
                    {banner.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => edit(banner)} aria-label="Edit banner"><Pencil size={16} /></button>
                  <button type="button" className="btn btn-ghost" onClick={() => remove(banner)} aria-label="Delete banner"><Trash2 size={16} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
