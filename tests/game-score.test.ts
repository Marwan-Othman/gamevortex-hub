import { describe, expect, it } from 'vitest';
import { vortexScore } from '../lib/game-score';

const base = { ratingAverage: 0, ratingCount: 0, playCount: 0, viewCount: 0, featured: false };

describe('vortexScore', () => {
  it('returns 0 for a game with no ratings, plays, views, or featured flag', () => {
    expect(vortexScore(base)).toBe(0);
  });

  it('never exceeds 100 even for maxed-out inputs', () => {
    const score = vortexScore({
      ratingAverage: 5,
      ratingCount: 1_000_000,
      playCount: 1_000_000,
      viewCount: 1_000_000,
      featured: true,
    });
    expect(score).toBeLessThanOrEqual(100);
  });

  it('ranks a highly-rated, well-reviewed game above an identically-rated game with almost no reviews', () => {
    const trusted = vortexScore({ ...base, ratingAverage: 4.5, ratingCount: 5000 });
    const unproven = vortexScore({ ...base, ratingAverage: 4.5, ratingCount: 1 });
    expect(trusted).toBeGreaterThan(unproven);
  });

  it('gives a small deterministic boost to featured games, all else equal', () => {
    const featured = vortexScore({ ...base, ratingAverage: 4, ratingCount: 100, featured: true });
    const notFeatured = vortexScore({ ...base, ratingAverage: 4, ratingCount: 100, featured: false });
    expect(featured).toBeGreaterThan(notFeatured);
  });

  it('rewards higher play counts and view counts, all else equal', () => {
    const popular = vortexScore({ ...base, ratingAverage: 3, ratingCount: 50, playCount: 10_000, viewCount: 50_000 });
    const obscure = vortexScore({ ...base, ratingAverage: 3, ratingCount: 50, playCount: 1, viewCount: 1 });
    expect(popular).toBeGreaterThan(obscure);
  });

  it('returns a non-negative integer', () => {
    const score = vortexScore({ ...base, ratingAverage: 2.3, ratingCount: 17, playCount: 42, viewCount: 900 });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
