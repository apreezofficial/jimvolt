import api from './api.js';

export const getSellerDashboard = () => api.get('/seller/dashboard');
export const getSellerAds = (params = {}, config = {}) => api.get('/seller/ads', { ...config, params });
export const updateSellerAdStatus = (id, status) => api.patch(`/seller/ads/${id}/status`, { status });
export const duplicateSellerAd = (id) => api.post(`/seller/ads/${id}/duplicate`);
export const getSellerAnalytics = (params = {}) => api.get('/seller/analytics', { params });
export const getAdvertisementAnalytics = (id, params = {}) => api.get(`/seller/analytics/${id}`, { params });
export const getSellerVerification = () => api.get('/seller/verification');
export const createSellerVerificationUploadUrls = (documents) => api.post(
  '/seller/verification/upload-urls',
  { documents },
  { timeout: 120000 },
);
export const submitSellerVerification = (formData) => api.post('/seller/verification', formData, { timeout: 120000 });
export const updateSellerVerification = (formData) => api.put('/seller/verification', formData, { timeout: 120000 });
export const getSellerNotifications = () => api.get('/seller/notifications');
export const markSellerNotificationRead = (id) => api.put(`/seller/notifications/${id}/read`);
export const getSellerStorefront = (slug) => api.get(`/seller/public/${encodeURIComponent(slug)}`);
export const getSellerProfileBySlug = (slug) => api.get(`/seller/public/slug/${encodeURIComponent(slug)}`);
export const checkUsername = (username) => api.get('/auth/username/check', { params: { username } });
export const updateUsername = (username) => api.put('/auth/username', { username });
