export function vortexScore(input: {
  ratingAverage: number;
  ratingCount: number;
  playCount: number;
  viewCount: number;
  featured: boolean;
}) {
  const rating = Math.max(0, Math.min(100, input.ratingAverage * 20));
  const confidence = Math.min(1, Math.log10(input.ratingCount + 1) / 3);
  const popularity = Math.min(100, Math.log10(input.playCount + 1) * 18);
  const discovery = Math.min(100, Math.log10(input.viewCount + 1) * 14);
  const featuredBoost = input.featured ? 4 : 0;
  return Math.round(Math.min(100, rating * (0.72 + confidence * 0.28) + popularity * 0.12 + discovery * 0.08 + featuredBoost));
}
