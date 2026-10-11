import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ownerRouteError, publicErrorCode, userRouteError } from '../lib/api';

const API_ROOT = join(__dirname, '..', 'app', 'api');

function routeFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const files = routeFiles(API_ROOT).map((file) => ({
  path: relative(API_ROOT, file).replace(/\\/g, '/'),
  source: readFileSync(file, 'utf8'),
}));

function handlers(source: string) {
  const parts = source.split(/(?=export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/).slice(1);
  return parts.map((part) => ({
    method: /export\s+(?:async\s+)?function\s+(\w+)/.exec(part)![1],
    body: part,
  }));
}

describe('publicErrorCode', () => {
  it('passes intentional domain codes through', () => {
    expect(publicErrorCode(new Error('INSUFFICIENT_POINTS'), 'FAILED')).toBe('INSUFFICIENT_POINTS');
    expect(publicErrorCode(new Error('PAYMENT_PROVIDER_NOT_CONFIGURED'), 'FAILED')).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
  });

  it('masks Prisma / provider / free-text messages', () => {
    expect(publicErrorCode(new Error('Invalid `prisma.user.findUnique()` invocation:\nUnique constraint failed'), 'FAILED')).toBe('FAILED');
    expect(publicErrorCode(new Error('connect ECONNREFUSED 10.0.0.5:5432'), 'FAILED')).toBe('FAILED');
    expect(publicErrorCode('boom', 'FAILED')).toBe('FAILED');
  });

  it('never reveals which secret is missing', () => {
    expect(publicErrorCode(new Error('AUTH_SECRET_NOT_CONFIGURED'), 'FAILED')).toBe('FAILED');
    expect(publicErrorCode(new Error('DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED'), 'FAILED')).toBe('FAILED');
  });
});

describe('route error helpers', () => {
  it('userRouteError maps auth and body errors', async () => {
    expect((await userRouteError(new Error('UNAUTHORIZED'), 'X')).status).toBe(401);
    expect((await userRouteError(new Error('FORBIDDEN'), 'X')).status).toBe(403);
    expect((await userRouteError(new SyntaxError('bad json'), 'X')).status).toBe(400);
    const masked = userRouteError(new Error('select * from "User"'), 'LOAD_FAILED');
    // Unexpected failure: 500, fixed code + requestId, and the raw SQL text never reaches the client.
    expect(masked.status).toBe(500);
    const maskedBody = await masked.json();
    expect(maskedBody.error).toBe('LOAD_FAILED');
    expect(typeof maskedBody.requestId).toBe('string');
    expect(JSON.stringify(maskedBody)).not.toContain('select');
  });

  it('ownerRouteError maps auth, validation and database errors without leaking text', async () => {
    expect(ownerRouteError(new Error('UNAUTHORIZED'), 'X').status).toBe(401);
    expect(ownerRouteError(new Error('FORBIDDEN'), 'X').status).toBe(403);
    const unexpected = ownerRouteError(new Error('relation "Secret" does not exist'), 'ADMIN_FAILED', 500);
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({ error: 'ADMIN_FAILED' });
    const notFound = Object.assign(new Error('Record to delete does not exist.'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
    expect(ownerRouteError(notFound, 'X').status).toBe(404);
  });
});

describe('API source audit (Phase 14)', () => {
  it('finds the API routes', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no route echoes a raw error.message to the client', () => {
    const offenders = files
      .filter(({ source }) => /(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*(?:"[^"]+"|'[^']+'|[A-Za-z_]\w*)/.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  // Webhooks / cron authenticate by signature or secret, login & register carry their own
  // per-account limiter; every other state-changing handler must run the CSRF + rate-limit guard.
  const MUTATION_GUARD_EXEMPT = new Set([
    'payments/webhook/route.ts',
    'auth/oauth/[provider]/callback/route.ts',
    'client-error/route.ts',
  ]);

  it('every state-changing handler uses guardMutation (CSRF origin check + rate limit)', () => {
    const offenders: string[] = [];
    for (const { path, source } of files) {
      if (MUTATION_GUARD_EXEMPT.has(path)) continue;
      for (const handler of handlers(source)) {
        if (handler.method === 'GET') continue;
        if (!/guardMutation|rateLimitAsync/.test(handler.body)) offenders.push(`${handler.method} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every non-public handler authenticates before doing work', () => {
    const PUBLIC = new Set([
      'apps/[slug]/route.ts', 'apps/route.ts', 'auth/login/route.ts', 'auth/logout/route.ts',
      'auth/oauth/[provider]/callback/route.ts', 'auth/oauth/[provider]/route.ts', 'auth/oauth/providers/route.ts',
      'auth/register/route.ts', 'client-error/route.ts', 'gamers/[username]/route.ts', 'games/[slug]/route.ts',
      'games/route.ts', 'marketplace/products/route.ts', 'quran/audio/route.ts', 'quran/reciters/route.ts',
      'rankings/route.ts', 'search/route.ts', 'wallpapers/[id]/view/route.ts',
      'health/route.ts', 'payments/webhook/route.ts', 'vip/plans/route.ts',
    ]);
    const AUTH = /requireUser|requireOwner|getOptionalUser|requireTrading|requireContentOwner|requireSuperAdmin|authorized\(|hashApiKey/;
    const offenders: string[] = [];
    for (const { path, source } of files) {
      if (PUBLIC.has(path)) continue;
      for (const handler of handlers(source)) {
        if (!AUTH.test(handler.body)) offenders.push(`${handler.method} ${path}`);
      }
    }
    // The only intentionally public handler left in a mixed file: GET /api/vip/rewards (active reward catalogue).
    expect(offenders).toEqual(['GET vip/rewards/route.ts']);
  });
});
