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
// OWNER_EMAIL is only required when automatic owner bootstrap is explicitly enabled.
if (production && process.env.REQUIRE_OWNER_BOOTSTRAP === '1') {
  if (!process.env.OWNER_EMAIL || !process.env.OWNER_INITIAL_PASSWORD) errors.push('OWNER_EMAIL and OWNER_INITIAL_PASSWORD are required when REQUIRE_OWNER_BOOTSTRAP=1.');
  if (process.env.OWNER_INITIAL_PASSWORD && process.env.OWNER_INITIAL_PASSWORD.length < 12) errors.push('OWNER_INITIAL_PASSWORD must be at least 12 characters.');
}
if (missing.length) errors.push(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) errors.push('AUTH_SECRET must be at least 32 characters.');
// Placeholders from the .env examples are public: they pass a length check but must never reach production.
const placeholderPattern = /(replace|change[_-]?me|changeme|placeholder|example|your[_-]?secret|your[_-]?key|secret[_-]?here|random[_-]?characters|todo|dummy|default|password|123456)/i;
const weakSecret = (value) => !value || placeholderPattern.test(value) || new Set(value).size < 8;
if (production) {
  for (const name of ['AUTH_SECRET', 'CRON_SECRET', 'DIGITAL_KEY_ENCRYPTION_SECRET', 'PAYMENT_WEBHOOK_SECRET']) {
    const value = process.env[name];
    if (value && weakSecret(value)) errors.push(`${name} looks like a placeholder or low-entropy value; generate a random one (openssl rand -base64 48).`);
  }
  if (process.env.POSTGRES_PASSWORD && weakSecret(process.env.POSTGRES_PASSWORD)) errors.push('POSTGRES_PASSWORD looks like a placeholder; use a strong random password.');
}
if (process.env.APP_ORIGIN) {
  try {
    const url = new URL(process.env.APP_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('APP_ORIGIN must use http or https.');
    if (url.pathname !== '/' || url.search || url.hash) errors.push('APP_ORIGIN must be an origin without a path, query, or hash.');
    if (production && url.protocol !== 'https:') errors.push('APP_ORIGIN must use HTTPS in production.');
  } catch { errors.push('APP_ORIGIN must be a valid URL.'); }
}
if (production && (!process.env.DIRECT_URL || String(process.env.DIRECT_URL).trim() === '')) {
  errors.push('DIRECT_URL is required in production so Prisma migrations use a direct database connection.');
}
if (process.env.DIRECT_URL) {
  try {
    const url = new URL(process.env.DIRECT_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('DIRECT_URL must be a PostgreSQL connection URL.');
    if (production && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) errors.push('DIRECT_URL must not point to localhost in production.');
    if (production && /-pooler\.|pooler\./i.test(url.hostname)) errors.push('DIRECT_URL must use a direct PostgreSQL endpoint, not a pooled endpoint.');
  } catch { errors.push('DIRECT_URL must be a valid PostgreSQL URL.'); }
}
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('DATABASE_URL must be a PostgreSQL connection URL.');
    if (production && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) errors.push('DATABASE_URL must not point to localhost in production.');
  } catch { errors.push('DATABASE_URL must be a valid PostgreSQL URL.'); }
}
if (production && (!process.env.GEMINI_API_KEY || !process.env.MANUS_API_KEY)) errors.push('GEMINI_API_KEY and MANUS_API_KEY are required in production.');
for (const name of ['CHAT_COST', 'ADVANCED_CHAT_COST', 'IMAGE_COST', 'IMAGE_EDIT_COST', 'HIGH_QUALITY_IMAGE_COST', 'VIDEO_COST', 'VIDEO_EDIT_COST']) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') continue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) errors.push(`${name} must be a positive integer (GVC credits) up to 1,000,000.`);
}
if (process.env.GEMINI_MAX_OUTPUT_TOKENS) {
  const tokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS);
  if (!Number.isInteger(tokens) || tokens < 64 || tokens > 65536) errors.push('GEMINI_MAX_OUTPUT_TOKENS must be an integer between 64 and 65536.');
}
const exposedSecretNames = Object.keys(process.env).filter((key) => /^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD)/i.test(key));
if (exposedSecretNames.length) errors.push('Secrets must not use NEXT_PUBLIC_: ' + exposedSecretNames.join(', '));
// Legacy GameVortex AI runtime variables are ignored by the application and must be removed from deployment settings.
const legacyRuntimeVars = ['GAMEVORTEX_AI_RUNTIME_URL', 'GAMEVORTEX_AI_RUNTIME_TOKEN', 'GAMEVORTEX_AI_MODEL'];
const staleLegacyVars = legacyRuntimeVars.filter((key) => process.env[key]);
if (staleLegacyVars.length) errors.push(`Legacy GameVortex AI runtime variables are no longer supported: ${staleLegacyVars.join(', ')}.`);
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
if (production && process.env.VERCEL && process.env.RATE_LIMIT_STORE !== 'upstash') {
  console.warn('WARNING: RATE_LIMIT_STORE is not "upstash". On Vercel every serverless instance keeps its own in-memory counters, so rate limits are only best-effort. Set RATE_LIMIT_STORE=upstash with UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
}
if (production && process.env.VERCEL && process.env.DATABASE_URL && !/pgbouncer=true|-pooler\.|pooler\./i.test(process.env.DATABASE_URL)) {
  console.warn('WARNING: DATABASE_URL does not look like a pooled connection. Serverless functions open many short-lived connections; use your provider\'s pooled URL (for example Neon "-pooler" host or Supabase pgbouncer) for the app and a direct URL only for migrations.');
}
if (errors.length) { console.error(errors.map((x) => `ERROR: ${x}`).join('\n')); process.exit(1); }
console.log(`Environment validation: PASS (${production ? 'production' : 'development'})`);
