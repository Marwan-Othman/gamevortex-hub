const production = process.env.NODE_ENV === 'production' || process.env.VALIDATE_PRODUCTION === '1';
const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_ORIGIN'];
const missing = required.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
const errors = [];
const numericPositive = (key) => {
  if (process.env[key] !== undefined && (!Number.isFinite(Number(process.env[key])) || Number(process.env[key]) <= 0)) {
    errors.push(`${key} must be a positive number.`);
  }
};
numericPositive('OWNER_POINTS_PER_USD');
numericPositive('OWNER_MIN_WITHDRAW_POINTS');
if (production && !process.env.OWNER_EMAIL) errors.push('OWNER_EMAIL is required in production to bind SUPER_ADMIN to the immutable owner identity.');
if (production && process.env.REQUIRE_OWNER_BOOTSTRAP === '1') {
  if (!process.env.OWNER_EMAIL || !process.env.OWNER_INITIAL_PASSWORD) errors.push('OWNER_EMAIL and OWNER_INITIAL_PASSWORD are required when REQUIRE_OWNER_BOOTSTRAP=1.');
  if (process.env.OWNER_INITIAL_PASSWORD && process.env.OWNER_INITIAL_PASSWORD.length < 12) errors.push('OWNER_INITIAL_PASSWORD must be at least 12 characters.');
}
if (missing.length) errors.push(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) errors.push('AUTH_SECRET must be at least 32 characters.');
if (process.env.APP_ORIGIN) {
  try {
    const url = new URL(process.env.APP_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('APP_ORIGIN must use http or https.');
    if (url.pathname !== '/' || url.search || url.hash) errors.push('APP_ORIGIN must be an origin without a path, query, or hash.');
    if (production && url.protocol !== 'https:') errors.push('APP_ORIGIN must use HTTPS in production.');
  } catch { errors.push('APP_ORIGIN must be a valid URL.'); }
}
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('DATABASE_URL must be a PostgreSQL connection URL.');
    if (production && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) errors.push('DATABASE_URL must not point to localhost in production.');
  } catch { errors.push('DATABASE_URL must be a valid PostgreSQL URL.'); }
}
if (process.env.OWNER_WITHDRAWAL_ENABLED === 'true') {
  if (!process.env.OWNER_EXTERNAL_WALLET_ADDRESS) errors.push('OWNER_EXTERNAL_WALLET_ADDRESS is required when owner withdrawals are enabled.');
  if (!process.env.PAYOUT_PROVIDER || !process.env.PAYOUT_PROVIDER_BASE_URL || !process.env.PAYOUT_PROVIDER_SECRET) errors.push('PAYOUT_PROVIDER, PAYOUT_PROVIDER_BASE_URL and PAYOUT_PROVIDER_SECRET are required when owner withdrawals are enabled.');
}
if (production && process.env.RATE_LIMIT_STORE === 'upstash' && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) errors.push('Upstash REST credentials are required when RATE_LIMIT_STORE=upstash.');
if (production && process.env.PAYMENT_PROVIDER === 'stripe' && !process.env.STRIPE_SECRET_KEY) errors.push('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.');
if (production && process.env.PAYMENT_PROVIDER === 'stripe' && !process.env.STRIPE_WEBHOOK_SECRET && !process.env.PAYMENT_WEBHOOK_SECRET) errors.push('STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe.');
if (production && process.env.PAYMENT_PROVIDER === 'paypal' && (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET || !process.env.PAYPAL_WEBHOOK_ID)) errors.push('PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID are required when PAYMENT_PROVIDER=paypal.');
if (production && process.env.PAYMENT_PROVIDER === 'hmac' && !process.env.PAYMENT_WEBHOOK_SECRET) errors.push('PAYMENT_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=hmac.');
if (production && process.env.PAYMENT_PROVIDER && process.env.PAYMENT_PROVIDER !== 'stripe' && process.env.PAYMENT_PROVIDER !== 'paypal' && process.env.PAYMENT_PROVIDER !== 'hmac') errors.push('PAYMENT_PROVIDER must be stripe, paypal, or hmac.');
if (production && process.env.PAYMENT_PROVIDER && (!process.env.DIGITAL_KEY_ENCRYPTION_SECRET || process.env.DIGITAL_KEY_ENCRYPTION_SECRET.length < 32)) errors.push('DIGITAL_KEY_ENCRYPTION_SECRET must be at least 32 characters when payments are enabled.');
if (production && process.env.RESEND_API_KEY && !process.env.EMAIL_FROM) errors.push('EMAIL_FROM is required when Resend email is enabled.');
if (production && process.env.AI_PROVIDER_BASE_URL && !process.env.AI_PROVIDER_API_KEY) errors.push('AI_PROVIDER_API_KEY is required when AI_PROVIDER_BASE_URL is configured.');
if (errors.length) { console.error(errors.map((x) => `ERROR: ${x}`).join('\n')); process.exit(1); }
console.log(`Environment validation: PASS (${production ? 'production' : 'development'})`);
