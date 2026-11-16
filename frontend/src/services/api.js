import axios from 'axios';

const getStoredToken = () => localStorage.getItem('jimvolt_token') || sessionStorage.getItem('jimvolt_token');
const clearStoredAuth = () => {
  localStorage.removeItem('jimvolt_token');
  localStorage.removeItem('jimvolt_user');
  sessionStorage.removeItem('jimvolt_token');
  sessionStorage.removeItem('jimvolt_user');
};

const STATUS_MESSAGES = {
  400: 'The server did not accept that request. Please check what you entered and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you asked for.',
  408: 'The request took too long. Please try again.',
  413: 'That upload is too large for the server. Remove some files or choose smaller ones.',
  415: 'That file type is not supported.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: 'Something went wrong on our side. Please try again shortly.',
  502: 'The server is temporarily unavailable. Please try again shortly.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
  504: 'The server took too long to respond. Please try again.',
};

/** Makes sure every failed request carries a human-readable `response.data.message`. */
function describeRequestError(error) {
  if (!error || error.code === 'ERR_CANCELED') return;
  const data = error.response?.data;
  if (typeof data?.message === 'string' && data.message.trim()) return;
  const status = error.response?.status ?? 0;
  let message = STATUS_MESSAGES[status];
  if (!message && status >= 500) message = STATUS_MESSAGES[500];
  if (!message && status >= 400) message = 'The request could not be completed. Please try again.';
  if (!message) {
    message = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
      ? 'The request timed out. Check your connection and try again.'
      : 'Could not reach the server. Check your internet connection and try again.';
  }
  error.response = { ...(error.response || {}), status, data: { ...(data && typeof data === 'object' ? data : {}), message } };
}

export const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isCredentialSubmission = /\/(?:auth\/login|admin\/login)\/?$/.test(requestUrl);
    if (error.response?.status === 401 && !isCredentialSubmission) {
      clearStoredAuth();
      window.dispatchEvent(new Event('jimvolt:unauthorized'));
    }
    describeRequestError(error);
    return Promise.reject(error);
  },
);

export default api;
