import { afterEach, describe, expect, it } from 'vitest';
import { rateLimit, sameOrigin, clientKey } from '../lib/security';

const previousAppOrigin = process.env.APP_ORIGIN;

afterEach(() => {
  if (previousAppOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousAppOrigin;
});

function fakeRequest(headers: Record<string, string>) {
  return new Request('https://gamevortex-hub.vercel.app/api/test', { headers });
}

describe('clientKey', () => {
  it('scopes the bucket key and prefers x-forwarded-for over x-real-ip', () => {
    const request = fakeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' });
    expect(clientKey(request, 'orders:checkout')).toBe('orders:checkout:1.2.3.4');
  });

  it('falls back to x-real-ip, then "unknown", when no forwarded header is present', () => {
    expect(clientKey(fakeRequest({ 'x-real-ip': '9.9.9.9' }), 'scope')).toBe('scope:9.9.9.9');
    expect(clientKey(fakeRequest({}), 'scope')).toBe('scope:unknown');
  });
});

describe('rateLimit (in-process token bucket)', () => {
  it('allows requests under the limit and blocks once the limit is reached', () => {
    const key = `test:${Math.random()}`;
    const first = rateLimit(key, 2, 60_000);
    const second = rateLimit(key, 2, 60_000);
    const third = rateLimit(key, 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
  });

  it('resets the bucket once the window has elapsed', () => {
    const key = `test:${Math.random()}`;
    expect(rateLimit(key, 1, 10).allowed).toBe(true);
    expect(rateLimit(key, 1, 10).allowed).toBe(false);
  });

  it('tracks independent buckets per key so one scope cannot exhaust another', () => {
    const keyA = `test:a:${Math.random()}`;
    const keyB = `test:b:${Math.random()}`;
    rateLimit(keyA, 1, 60_000);
    expect(rateLimit(keyB, 1, 60_000).allowed).toBe(true);
  });
});

describe('sameOrigin (CSRF check for state-changing routes)', () => {
  it('allows a request with no Origin header (native fetch/server-to-server callers)', () => {
    expect(sameOrigin(fakeRequest({}))).toBe(true);
  });

  it('allows a same-origin request matching APP_ORIGIN', () => {
    process.env.APP_ORIGIN = 'https://gamevortex-hub.vercel.app';
    expect(sameOrigin(fakeRequest({ origin: 'https://gamevortex-hub.vercel.app' }))).toBe(true);
  });

  it('rejects a request whose Origin does not match the configured APP_ORIGIN', () => {
    process.env.APP_ORIGIN = 'https://gamevortex-hub.vercel.app';
    expect(sameOrigin(fakeRequest({ origin: 'https://evil-clone.example' }))).toBe(false);
  });

  it('rejects a cross-site request even when Origin matches, per sec-fetch-site', () => {
    process.env.APP_ORIGIN = 'https://gamevortex-hub.vercel.app';
    expect(
      sameOrigin(
        fakeRequest({
          origin: 'https://gamevortex-hub.vercel.app',
          'sec-fetch-site': 'cross-site',
        })
      )
    ).toBe(false);
  });
});
