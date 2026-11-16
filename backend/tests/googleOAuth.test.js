const assert = require('node:assert/strict')
const test = require('node:test')
const googleOAuth = require('../services/googleOAuthService')

test('Google sign-in is off until both client values are configured', () => {
  const original = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
  try {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    assert.equal(googleOAuth.isGoogleConfigured(), false)
    process.env.GOOGLE_CLIENT_ID = 'client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
    assert.equal(googleOAuth.isGoogleConfigured(), true)
  } finally {
    if (original.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original.id
    if (original.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = original.secret
  }
})

test('authorization URL requests the code flow with the state value and email scope', () => {
  const original = { id: process.env.GOOGLE_CLIENT_ID, site: process.env.PUBLIC_SITE_URL, redirect: process.env.GOOGLE_REDIRECT_URI }
  try {
    process.env.GOOGLE_CLIENT_ID = 'client-id'
    process.env.PUBLIC_SITE_URL = 'https://jimvolt.com/'
    delete process.env.GOOGLE_REDIRECT_URI
    const url = new URL(googleOAuth.buildAuthorizationUrl('state-123'))
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(url.searchParams.get('client_id'), 'client-id')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('state'), 'state-123')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://jimvolt.com/api/auth/google/callback')
    assert.ok(url.searchParams.get('scope').split(' ').includes('email'))
  } finally {
    if (original.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original.id
    if (original.site === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = original.site
    if (original.redirect === undefined) delete process.env.GOOGLE_REDIRECT_URI; else process.env.GOOGLE_REDIRECT_URI = original.redirect
  }
})
