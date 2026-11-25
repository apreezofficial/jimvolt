import api, { API_BASE_URL } from './api.js';

// Banner shape, matching the homepage "Sell your solar equipment" section (1200 x 152 px).
export const BANNER_SIZE = { width: 1200, height: 152, recommended: '2400 x 304' };

export const getBanners = () => api.get('/banners');

// Image URLs come back relative to the API (/api/banners/1/image?v=...). Point them at the API host.
export function bannerImageSrc(imageUrl) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
  return new URL(imageUrl, `${apiOrigin}/`).toString();
}

export const getAdminBanners = () => api.get('/admin/banners');
export const saveAdminBanner = (formData, id) => (id
  ? api.put(`/admin/banners/${id}`, formData, { timeout: 60000 })
  : api.post('/admin/banners', formData, { timeout: 60000 }));
export const deleteAdminBanner = (id) => api.delete(`/admin/banners/${id}`);

// Admin previews need the login token, so the image is fetched as a blob instead of an <img src>.
export const getAdminBannerImage = (id) => api.get(`/admin/banners/${id}/image`, { responseType: 'blob' });

// ---- Paid banners (advertisers) ----
export const getBannerPricing = () => api.get('/banners/pricing');
export const createBannerOrder = (formData) => api.post('/banners/orders', formData, { timeout: 60000 });
export const verifyBannerOrder = (reference) => api.get(`/banners/orders/${encodeURIComponent(reference)}/verify`);
export const getMyBanners = () => api.get('/banners/mine');

// ---- Admin review and pricing ----
export const approveAdminBanner = (id) => api.put(`/admin/banners/${id}/approve`);
export const rejectAdminBanner = (id, note) => api.put(`/admin/banners/${id}/reject`, { note });
export const getAdminBannerSettings = () => api.get('/admin/banner-settings');
export const saveAdminBannerSettings = (pricePerDay) => api.put('/admin/banner-settings', { pricePerDay });
