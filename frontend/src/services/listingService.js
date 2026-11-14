import api from './api.js';

export async function getAds(params = {}) {
  const { data } = await api.get('/ads/search', { params });
  return data;
}

export async function getSearchSuggestions(q, signal) {
  const { data } = await api.get('/ads/search/suggestions', { params: { q }, signal });
  return data.suggestions;
}

export async function getCitiesForState(state, signal) {
  if (!state) return [];
  const { data } = await api.get('/ads/locations/cities', { params: { state }, signal });
  return data.cities;
}

export const getFeatured = async () => (await getAds({ featured: 'true', limit: 8 })).advertisements;
export const getPromoted = async () => (await api.get('/payments/featured')).data.advertisements;
export const trackSponsoredAd = (id, event) => api.post(`/payments/track/${id}`, { event });
// The seed changes every 10 minutes (not on every load) so the server and CDN can reuse the response.
export const getDiscover = async () => (await getAds({ sort: 'random', seed: Math.floor(Date.now() / 600000), limit: 8 })).advertisements;
export const getRecent = async () => (await getAds({ sort: 'newest', limit: 8 })).advertisements;
export const getPopular = async () => (await getAds({ sort: 'popular', limit: 4 })).advertisements;

export async function getVerifiedSellers() {
  const { data } = await api.get('/users/sellers');
  return data.sellers;
}

export async function getPopularLocations() {
  const { data } = await api.get('/ads/locations/popular');
  return data.locations;
}

export async function getCategories() {
  const { data } = await api.get('/categories');
  return data.categories;
}

export async function getAd(id) {
  const { data } = await api.get(`/ads/${id}`);
  return data.advertisement;
}

export async function getSeller(id) {
  const { data } = await api.get(`/ads/sellers/${id}`);
  return data;
}

export async function createAd(payload, onUploadProgress) {
  return api.post('/ads', payload, { onUploadProgress, timeout: 120000 });
}

export async function updateAd(id, payload, onUploadProgress) {
  return api.put(`/ads/${id}`, payload, { onUploadProgress, timeout: 120000 });
}

export async function deleteAd(id) {
  return api.delete(`/ads/${id}`);
}

export async function sendSellerMessage(payload) {
  return api.post('/messages', payload);
}
