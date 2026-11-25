import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ImagePlus, LoaderCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNaira } from '../utils/format.js';
import { createBannerOrder, getBannerPricing, getMyBanners, verifyBannerOrder } from '../services/bannerService.js';

const FALLBACK = { pricePerDay: '5000.00', minDays: 1, maxDays: 90, size: { width: 1200, height: 152, recommended: '2400 x 304' } };
const QUICK_DAYS = [7, 14, 30];
const STATUS_LABELS = {
  pending_payment: 'Waiting for payment',
  pending_review: 'Paid. Waiting for approval',
  active: 'Live',
  rejected: 'Rejected',
};

// Price in kobo so the live total matches what the server charges.
function totalFor(days, pricePerDay) {
  const [whole, fraction = ''] = String(pricePerDay).split('.');
  const perDay = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  return Number((perDay * BigInt(days)) / 100n) + Number((perDay * BigInt(days)) % 100n) / 100;
}

function checkImageShape(file, size) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = image.naturalWidth / image.naturalHeight;
      const wanted = size.width / size.height;
      if (image.naturalWidth < size.width) resolve(`This image is ${image.naturalWidth} x ${image.naturalHeight}. It must be at least ${size.width} px wide. Use ${size.recommended} px.`);
      else if (Math.abs(ratio - wanted) / wanted > 0.04) resolve(`This image is ${image.naturalWidth} x ${image.naturalHeight}, the wrong shape. Use ${size.recommended} px.`);
      else resolve('');
    };
    image.onerror = () => { URL.revokeObjectURL(url); resolve('This file could not be read as an image.'); };
    image.src = url;
  });
}

function daysLeft(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

export default function AdvertisePage() {
  const { isAuthenticated } = useAuth();
  const [params] = useSearchParams();
  const returnedReference = params.get('banner_reference');
  const [pricing, setPricing] = useState(FALLBACK);
  const [days, setDays] = useState(7);
  const [form, setForm] = useState({ title: '', linkUrl: '', altText: '' });
  const [file, setFile] = useState(null);
  const [fileProblem, setFileProblem] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [mine, setMine] = useState([]);
  const fileInput = useRef(null);

  useEffect(() => {
    getBannerPricing().then(({ data }) => setPricing({ ...FALLBACK, ...data })).catch(() => {});
  }, []);

  const loadMine = () => getMyBanners().then(({ data }) => setMine(data.banners || [])).catch(() => {});

  useEffect(() => { if (isAuthenticated) loadMine(); }, [isAuthenticated]);

  // Back from Paystack: confirm the payment with the server.
  useEffect(() => {
    if (!returnedReference || !isAuthenticated) return;
    setNotice({ type: 'info', text: 'Checking your payment with Paystack…' });
    verifyBannerOrder(returnedReference)
      .then(({ data }) => {
        if (data.status === 'succeeded') {
          setNotice({ type: 'success', text: 'Payment received. Your banner is waiting for approval and goes live as soon as we approve it.' });
          loadMine();
        } else if (data.status === 'failed') {
          setNotice({ type: 'error', text: 'The payment was not completed, so no banner was ordered. You have not been charged.' });
        } else {
          setNotice({ type: 'info', text: 'Your payment is still processing. This page will show your banner once Paystack confirms it.' });
        }
      })
      .catch((requestError) => setNotice({ type: 'error', text: requestError.response?.data?.message || 'We could not check this payment. Contact support with your reference.' }));
  }, [returnedReference, isAuthenticated]);

  const total = useMemo(() => totalFor(days, pricing.pricePerDay), [days, pricing.pricePerDay]);

  const chooseFile = async (event) => {
    const chosen = event.target.files?.[0] || null;
    setFile(chosen);
    setFileProblem(chosen ? await checkImageShape(chosen, pricing.size) : '');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!file) { setError(`Choose your banner image (${pricing.size.recommended} px).`); return; }
    if (fileProblem) { setError(fileProblem); return; }
    const body = new FormData();
    body.append('image', file);
    body.append('title', form.title);
    body.append('linkUrl', form.linkUrl);
    body.append('altText', form.altText);
    body.append('days', String(days));
    setSubmitting(true);
    try {
      const { data } = await createBannerOrder(body);
      window.location.assign(data.authorizationUrl);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not start the payment. Please try again.');
      setSubmitting(false);
    }
  };

  const clampDays = (value) => {
    const number = Math.round(Number(value) || pricing.minDays);
    setDays(Math.min(pricing.maxDays, Math.max(pricing.minDays, number)));
  };

  return (
    <div className="container section advertise-page">
      <header className="section-heading">
        <p className="eyebrow">Advertise on Jimvolt</p>
        <h1>Put your banner on the homepage</h1>
        <p className="muted">Your banner rotates in the slideshow at the top of the homepage. You pay for the days you choose: {formatNaira(Number(pricing.pricePerDay))} per day, so more days cost more. The days start when we approve your banner.</p>
      </header>

      {notice && <div className={`notice ${notice.type === 'success' ? 'success' : notice.type === 'error' ? 'error' : ''}`} role="status">{notice.text}</div>}

      {!isAuthenticated ? (
        <div className="panel advertise-login">
          <p>Sign in or create a free account to order a banner.</p>
          <Link className="btn btn-primary" to="/login" state={{ from: '/advertise' }}>Sign in</Link>{' '}
          <Link className="btn btn-white" to="/register">Create account</Link>
        </div>
      ) : (
        <form className="panel advertise-form" onSubmit={submit}>
          <label className="field">
            <span><ImagePlus size={16} aria-hidden="true" /> Banner image</span>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" onChange={chooseFile} />
            <small className="muted">PNG or JPEG, <strong>{pricing.size.recommended} px</strong> (shown at {pricing.size.width} x {pricing.size.height}), under 1.5 MB. Keep text away from the edges, because phones crop the sides.</small>
            {fileProblem && <small className="field-error" role="alert">{fileProblem}</small>}
          </label>
          <label className="field"><span>Title</span><input value={form.title} minLength="2" maxLength="120" required onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Your business or offer" /></label>
          <label className="field"><span>Link (optional)</span><input type="url" value={form.linkUrl} maxLength="2048" placeholder="https://" onChange={(event) => setForm({ ...form, linkUrl: event.target.value })} /></label>
          <label className="field"><span>Image description for screen readers (optional)</span><input value={form.altText} maxLength="200" onChange={(event) => setForm({ ...form, altText: event.target.value })} /></label>

          <div className="field">
            <span><CalendarDays size={16} aria-hidden="true" /> How many days?</span>
            <div className="advertise-days">
              {QUICK_DAYS.map((value) => (
                <button key={value} type="button" className={`btn ${days === value ? 'btn-primary' : 'btn-white'}`} onClick={() => setDays(value)}>{value} days</button>
              ))}
              <input type="number" aria-label="Number of days" min={pricing.minDays} max={pricing.maxDays} value={days} onChange={(event) => setDays(event.target.value === '' ? '' : Number(event.target.value))} onBlur={(event) => clampDays(event.target.value)} />
            </div>
          </div>

          <p className="advertise-total" aria-live="polite">
            <span>{days || 0} day{days === 1 ? '' : 's'} × {formatNaira(Number(pricing.pricePerDay))}</span>
            <strong>{formatNaira(total)}</strong>
          </p>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting || !days}>
            {submitting ? <><LoaderCircle size={16} className="spin" /> Preparing secure checkout…</> : `Pay ${formatNaira(total)} with Paystack`}
          </button>
          <p className="muted">Banners are reviewed before they go live. If we cannot approve yours, we tell you why and refund the payment.</p>
        </form>
      )}

      {isAuthenticated && mine.length > 0 && (
        <section className="advertise-mine">
          <h2>Your banners</h2>
          <div className="advertise-list">
            {mine.map((banner) => (
              <article className="panel" key={banner.id}>
                <strong>{banner.title}</strong>
                <p className="muted">
                  {banner.is_expired ? 'Finished' : STATUS_LABELS[banner.status] || banner.status}
                  {banner.duration_days ? ` · ${banner.duration_days} days` : ''}
                  {banner.paid_amount ? ` · ${formatNaira(Number(banner.paid_amount))}` : ''}
                </p>
                {banner.is_live && banner.ends_at && <p>{daysLeft(banner.ends_at)} day{daysLeft(banner.ends_at) === 1 ? '' : 's'} left</p>}
                {banner.status === 'rejected' && banner.review_note && <p className="notice error">Not approved: {banner.review_note}</p>}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
