import { useEffect, useState } from 'react';
import { Check, Download, FileCheck2, X } from 'lucide-react';
import api from '../services/api.js';
import { formatNaira } from '../utils/format.js';
import { resolveImageUrl } from '../utils/imageUrl.js';

export default function AdminPage({ initialTab = 'advertisements' }) {
  const [advertisements, setAdvertisements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [verifications, setVerifications] = useState([]);
  const [reviewNotes, setReviewNotes] = useState({});
  const [verificationError, setVerificationError] = useState('');

  const loadPending = async () => {
    setError('');
    try {
      const { data } = await api.get('/admin/advertisements/pending');
      setAdvertisements(data.advertisements);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load advertisements for review.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPending(); }, []);

  const loadVerifications = async () => {
    setVerificationError('');
    try {
      const { data } = await api.get('/admin/verifications/pending');
      setVerifications(data.verifications);
    } catch (requestError) {
      setVerificationError(requestError.response?.data?.message || 'Could not load verification requests.');
    }
  };
  useEffect(() => { if (activeTab === 'verifications') loadVerifications(); }, [activeTab]);

  const moderate = async (id, status) => {
    setWorkingId(id);
    setError('');
    try {
      await api.patch(`/admin/advertisements/${id}/status`, { status });
      setAdvertisements((current) => current.filter((ad) => ad.id !== id));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update this advertisement.');
    } finally {
      setWorkingId(null);
    }
  };

  const review = async (id, status) => {
    setWorkingId(id);
    setVerificationError('');
    try {
      await api.patch(`/admin/verifications/${id}/status`, { status, notes: reviewNotes[id] || '' });
      setVerifications((current) => current.filter((item) => item.id !== id));
    } catch (requestError) {
      setVerificationError(requestError.response?.data?.message || 'Could not review this seller request.');
    } finally { setWorkingId(null); }
  };

  const downloadDocument = async (id, type) => {
    setWorkingId(id);
    setVerificationError('');
    try {
      const { data } = await api.get(`/admin/verifications/${id}/document/${type}`, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      const extension = {
        'application/pdf': 'pdf',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
      }[data.type] || 'document';
      anchor.download = `seller-verification-${type}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (requestError) {
      setVerificationError(requestError.response?.data?.message || 'Could not retrieve the private document.');
    } finally { setWorkingId(null); }
  };

  return (
    <div className="container section">
      <header className="section-head"><div><p className="eyebrow">Marketplace administration</p><h1>Review queue</h1><p className="muted">Review advertisements and seller verification requests.</p></div></header>
      <div className="admin-tabs"><button type="button" className={activeTab === 'advertisements' ? 'active' : ''} onClick={() => setActiveTab('advertisements')}>Advertisements</button><button type="button" className={activeTab === 'verifications' ? 'active' : ''} onClick={() => setActiveTab('verifications')}><FileCheck2 size={16} /> Seller verification</button></div>
      {activeTab === 'advertisements' && <>
      {error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <div className="empty">Loading review queue...</div> : !advertisements.length ? <div className="empty">The advertisement review queue is clear.</div> : (
        <div className="admin-queue">{advertisements.map((ad) => (
          <article className="panel admin-review-card" key={ad.id}>
            {ad.images?.[0] && <img src={resolveImageUrl(ad.images[0])} alt="" />}
            <div className="admin-review-content">
              <p className="eyebrow">{ad.category?.name} · {ad.city}, {ad.state}</p>
              <h2>{ad.title}</h2>
              <strong>{formatNaira(ad.price)}</strong>
              <p>{ad.description}</p>
              <small>Submitted by {ad.seller?.name}</small>
              <div className="admin-review-actions">
                <button className="btn btn-primary" type="button" disabled={workingId === ad.id} onClick={() => moderate(ad.id, 'approved')}><Check size={16} /> Approve</button>
                <button className="btn btn-white" type="button" disabled={workingId === ad.id} onClick={() => moderate(ad.id, 'rejected')}><X size={16} /> Reject</button>
              </div>
            </div>
          </article>
        ))}</div>
      )}
      </>}
      {activeTab === 'verifications' && <>
        {verificationError && <div className="notice error" role="alert">{verificationError}</div>}
        {!verifications.length && !verificationError ? <div className="empty">There are no seller verification requests awaiting review.</div> : <div className="verification-review-list">{verifications.map((item) => <article className="panel" key={item.id}>
          <div className="verification-review-heading"><div><p className="eyebrow">{item.verification_type.replaceAll('_', ' ')}</p><h2>{item.business_name || item.full_name}</h2><p className="muted">{item.full_name} · {item.email}</p></div><time>{new Date(item.submitted_at).toLocaleDateString('en-NG')}</time></div>
          <dl className="verification-review-details"><div><dt>Registration number</dt><dd>{item.registration_number || 'Not provided'}</dd></div><div><dt>Business address</dt><dd>{item.business_address}</dd></div><div><dt>Business phone</dt><dd>{item.business_phone}</dd></div></dl>
          <div className="admin-review-actions">
            {[
              ['cac', 'CAC certificate', item.has_cac_document],
              ['identity', 'Identity document', item.has_identity_document],
              ['additional', 'Additional document', item.has_additional_document],
            ].filter(([, , available]) => available).map(([type, label]) => (
              <button key={type} type="button" className="btn btn-white" disabled={workingId === item.id} onClick={() => downloadDocument(item.id, type)}>
                <Download size={16} /> Download {label}
              </button>
            ))}
          </div>
          <label className="field verification-review-notes"><span>Review notes (required when rejecting)</span><textarea rows="2" maxLength="1000" value={reviewNotes[item.id] || ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
          <div className="admin-review-actions"><button className="btn btn-primary" type="button" disabled={workingId === item.id} onClick={() => review(item.id, 'verified')}><Check size={16} /> Verify seller</button><button className="btn btn-white" type="button" disabled={workingId === item.id || !reviewNotes[item.id]?.trim()} onClick={() => review(item.id, 'rejected')}><X size={16} /> Reject request</button></div>
        </article>)}</div>}
      </>}
    </div>
  );
}
