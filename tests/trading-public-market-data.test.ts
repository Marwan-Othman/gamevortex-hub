import { describe, expect, it } from 'vitest';
import { fetchPublicKlines, normalizePublicSymbol } from '../lib/trading/binance-public-market-data';

const row = (t: number, c: string) => [t, c, c, c, c, '5', t + 1, '0', 1, '0', '0', '0'];
const okFetch = (rows: unknown[]) => (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;

describe('binance public market data', () => {
  it('normalizes pair notation and rejects unsafe symbols', () => {
    expect(normalizePublicSymbol('eth/usdt')).toBe('ETHUSDT');
    expect(() => normalizePublicSymbol('BTC USDT;')).toThrow('PUBLIC_MARKET_DATA_INVALID_SYMBOL');
  });
  it('maps klines to candles', async () => {
    const r = await fetchPublicKlines({ symbol: 'BTC/USDT', interval: '1h', limit: 2 }, okFetch([row(1_700_000_000_000, '100'), row(1_700_003_600_000, '101')]));
    expect(r.symbol).toBe('BTCUSDT');
    expect(r.candles).toHaveLength(2);
    expect(r.candles[1].close).toBe(101);
  });
  it('validates interval, limit and maps provider status codes', async () => {
    await expect(fetchPublicKlines({ symbol: 'BTCUSDT', interval: '1d', limit: 10 }, okFetch([]))).rejects.toThrow('PUBLIC_MARKET_DATA_INVALID_INTERVAL');
    await expect(fetchPublicKlines({ symbol: 'BTCUSDT', interval: '1h', limit: 5000 }, okFetch([]))).rejects.toThrow('PUBLIC_MARKET_DATA_INVALID_LIMIT');
    const f451 = (async () => new Response('{}', { status: 451 })) as unknown as typeof fetch;
    await expect(fetchPublicKlines({ symbol: 'BTCUSDT', interval: '1h', limit: 10 }, f451)).rejects.toThrow('PUBLIC_MARKET_DATA_REGION_BLOCKED');
  });
});
