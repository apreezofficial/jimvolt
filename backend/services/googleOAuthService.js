// Google sign-in using the standard OAuth 2.0 authorization-code flow.
// Uses Node's built-in fetch, so no extra dependency is needed.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function redirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI
  const siteUrl = process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:5173'
  return `${siteUrl.replace(/\/$/, '')}/api/auth/google/callback`
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

async function fetchProfileFromCode(code) {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenResponse.ok) throw new Error('Google rejected the sign-in code.')
  const { access_token: accessToken } = await tokenResponse.json()

  const profileResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileResponse.ok) throw new Error('Could not read the Google profile.')
  const profile = await profileResponse.json()

  return {
    sub: String(profile.sub || ''),
    email: String(profile.email || '').toLowerCase(),
    emailVerified: profile.email_verified === true,
    name: String(profile.name || '').trim(),
  }
}

module.exports = { buildAuthorizationUrl, fetchProfileFromCode, isGoogleConfigured }
