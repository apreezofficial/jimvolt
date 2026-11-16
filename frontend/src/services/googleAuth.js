import { API_BASE_URL } from './api.js';

// Full-page navigation to the backend, which redirects to Google and back.
export const GOOGLE_SIGN_IN_URL = `${API_BASE_URL}/auth/google`;

const OAUTH_ERRORS = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'Google sign-in expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_unverified_email: 'Your Google email address is not verified.',
  google_not_configured: 'Google sign-in is not set up yet.',
  account_suspended: 'This account is suspended.',
};

export function googleErrorMessage(code) {
  return OAUTH_ERRORS[code] || null;
}
