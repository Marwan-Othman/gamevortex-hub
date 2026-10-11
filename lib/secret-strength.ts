/**
 * Detects secrets that are too short, copied from an .env example, or obviously
 * low-entropy. A placeholder such as "replace-with-at-least-32-random-characters"
 * is 42 characters long, so a length check alone would accept a PUBLIC value as
 * AUTH_SECRET and let anyone forge session cookies.
 */
const PLACEHOLDER_PATTERN = /(replace|change[_-]?me|changeme|placeholder|example|your[_-]?secret|your[_-]?key|secret[_-]?here|random[_-]?characters|todo|dummy|default|password|123456)/i;

export function isWeakSecret(value: string | undefined | null, minLength = 32): boolean {
  if (!value || value.length < minLength) return true;
  if (PLACEHOLDER_PATTERN.test(value)) return true;
  // e.g. "xxxxxxxx…" or "abababab…": too few distinct characters to be random.
  return new Set(value).size < 8;
}
