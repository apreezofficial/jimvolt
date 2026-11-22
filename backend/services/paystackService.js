function serviceError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function toKobo(amount) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount))
  if (!match) throw serviceError('Payment amounts must use up to two decimal places.', 400)
  const value = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw serviceError('Payment amount is outside the supported range.', 400)
  }
  return Number(value)
}

/**
 * Resolves the Paystack secret key for the configured mode.
 *
 *   PAYSTACK_MODE=test  -> PAYSTACK_TEST_SECRET_KEY (sk_test_...)
 *   PAYSTACK_MODE=live  -> PAYSTACK_LIVE_SECRET_KEY (sk_live_...)
 *
 * PAYSTACK_SECRET_KEY is used when the mode-specific key is not set. Paystack
 * decides test or live from the key itself, so a key that does not match the
 * chosen mode is rejected instead of silently charging the wrong environment.
 */
function paystackMode() {
  return String(process.env.PAYSTACK_MODE || '').trim().toLowerCase() === 'live' ? 'live' : 'test'
}

function getSecretKey() {
  const mode = paystackMode()
  const key = (mode === 'live' ? process.env.PAYSTACK_LIVE_SECRET_KEY : process.env.PAYSTACK_TEST_SECRET_KEY)
    || process.env.PAYSTACK_SECRET_KEY
  if (!key) return null
  const expectedPrefix = mode === 'live' ? 'sk_live_' : 'sk_test_'
  if (!key.startsWith(expectedPrefix)) {
    throw serviceError(`PAYSTACK_MODE is ${mode}, but the configured Paystack key is not a ${expectedPrefix}... key.`, 503)
  }
  return key
}

function secretKey() {
  const key = getSecretKey()
  if (!key) throw serviceError('Online payments are not configured.', 503)
  return key
}

async function requestPaystack(path, options = {}) {
  let response
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(12000),
    })
  } catch {
    throw serviceError('The payment provider is temporarily unavailable.', 503)
  }

  const result = await response.json().catch(() => null)
  if (!response.ok || result?.status !== true || !result.data) {
    throw serviceError('The payment provider could not process the request.', 502)
  }
  return result.data
}

async function initializeTransaction({ email, reference, amount, callbackUrl, metadata }) {
  return requestPaystack('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      reference,
      amount: toKobo(amount),
      currency: 'NGN',
      callback_url: callbackUrl,
      metadata,
    }),
  })
}

async function verifyTransaction(reference) {
  return requestPaystack(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
}

// Starts a Paystack checkout for a promotion. The Paystack reference doubles as the checkout id.
async function createPromotionCheckout({ email, reference, amount, callbackUrl, promotionId }) {
  const transaction = await initializeTransaction({
    email,
    reference,
    amount,
    callbackUrl,
    metadata: { promotionId, paymentReference: reference },
  })
  return {
    checkout_id: reference,
    checkout_url: transaction.authorization_url,
    expires_at: null,
  }
}

// Reads the transaction from Paystack and maps it to the checkout shape promotionModel verifies.
async function getCheckout(reference) {
  const data = await verifyTransaction(reference)
  const succeeded = data.status === 'success'
  const failed = ['failed', 'abandoned', 'reversed'].includes(data.status)
  return {
    checkout_id: reference,
    reference,
    payment_status: succeeded ? 'paid' : 'unpaid',
    status: succeeded ? 'completed' : failed ? 'expired' : 'pending',
    amount: (Number(data.amount) / 100).toFixed(2),
    currency: data.currency,
  }
}

module.exports = { createPromotionCheckout, getCheckout, getSecretKey, initializeTransaction, paystackMode, toKobo, verifyTransaction }