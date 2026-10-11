import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  internalError,
  ownerRouteError,
  statusForErrorCode,
  userRouteError,
} from '@/lib/api';
import { friendlyError, messageFromResponse } from '@/lib/error-messages';
import { fetchWithTimeout, readJsonSafe } from '@/lib/fetch-timeout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Phase 18: HTTP status mapping', () => {
  it('maps domain codes to truthful statuses', () => {
    expect(statusForErrorCode('UNAUTHORIZED')).toBe(401);
    expect(statusForErrorCode('FORBIDDEN')).toBe(403);
    expect(statusForErrorCode('GAME_NOT_FOUND')).toBe(404);
    expect(statusForErrorCode('RATE_LIMITED')).toBe(429);
    expect(statusForErrorCode('PAYMENT_PROVIDER_NOT_CONFIGURED')).toBe(503);
    expect(statusForErrorCode('EMAIL_ALREADY_REGISTERED')).toBe(409);
    expect(statusForErrorCode('INSUFFICIENT_POINTS')).toBe(400);
  });

  it('userRouteError passes domain codes through with their status', async () => {
    const r = userRouteError(new Error('GAME_NOT_FOUND'), 'X');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'GAME_NOT_FOUND' });
  });
});

describe('Phase 18: unexpected errors', () => {
  it('internalError returns 500 + requestId, logs detail, never leaks the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = internalError('test', new Error('connect postgres://user:pw@db/x failed'), 'TEST_FAILED');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe('TEST_FAILED');
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.stringify(body)).not.toContain('postgres');
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain('"scope":"test"');
    expect(logged).toContain(body.requestId);
    expect(logged).not.toContain('user:pw');
  });

  it('database outage answers 503 with Retry-After', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('Can not reach'), { code: 'P1001' });
    const r = internalError('test', err);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('30');
    expect((await r.json()).error).toBe('SERVICE_UNAVAILABLE');
  });

  it('ownerRouteError never echoes non-domain messages', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = ownerRouteError(new Error('relation "X" does not exist'), 'ADMIN_FAILED', 500);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'ADMIN_FAILED' });
  });
});

describe('Phase 18: client messages', () => {
  it('never shows a raw English code', () => {
    expect(friendlyError('SOMETHING_ODD')).not.toContain('SOMETHING_ODD');
    expect(friendlyError('RATE_LIMITED')).toMatch(/[\u0600-\u06FF]/);
  });

  it('survives an HTML error page', async () => {
    const res = new Response('<html>Bad gateway</html>', { status: 502 });
    expect(await messageFromResponse(res)).toMatch(/[\u0600-\u06FF]/);
  });

  it('adds a short reference id for 5xx', async () => {
    const res = new Response(JSON.stringify({ error: 'INTERNAL_ERROR', requestId: 'abcdef12-3456' }), { status: 500 });
    expect(await messageFromResponse(res)).toContain('abcdef12');
  });
});

describe('Phase 18: fetchWithTimeout', () => {
  it('aborts a hanging upstream', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(fetchWithTimeout('https://example.test', {}, 20)).rejects.toThrow();
  });

  it('readJsonSafe returns {} for non-JSON', async () => {
    expect(await readJsonSafe(new Response('<html>'))).toEqual({});
  });
});

describe('Phase 18: every route handler has a try/catch (or delegates to one)', () => {
  const DELEGATING = new Set(['app/download/app/[slug]/route.ts', 'app/download/game/[slug]/route.ts']);
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : name === 'route.ts' ? [full] : [];
    });
  }
  it('finds no unguarded handlers', () => {
    const offenders: string[] = [];
    for (const file of walk('app')) {
      const rel = file.split(path.sep).join('/');
      if (DELEGATING.has(rel)) continue;
      const parts = readFileSync(file, 'utf8')
        .split(/(?=export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/)
        .slice(1);
      for (const part of parts) {
        if (!/\btry\s*\{/.test(part)) offenders.push(`${part.match(/function\s+(\w+)/)?.[1]} ${rel}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
