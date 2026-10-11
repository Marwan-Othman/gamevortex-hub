/**
 * Removes credentials from text before it reaches logs or the SystemError table.
 * Prisma/provider error messages can embed query arguments, connection strings,
 * bearer tokens or hashes; none of that must be persisted.
 */
const RULES: Array<[RegExp, string]> = [
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s"'<>]+/gi, "$1://[REDACTED]"],
  [/(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, "$1 [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]"],
  [/\bscrypt\$[0-9a-f]+\$[0-9a-f]+/gi, "[REDACTED_HASH]"],
  [/\bgvh_live_[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]"],
  [/\b(?:sk|pk|rk|whsec)_(?:live|test)?_?[A-Za-z0-9]{8,}/g, "[REDACTED_KEY]"],
  [/\b(?:AIza[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|re_[A-Za-z0-9]{16,}|vercel_blob_rw_[A-Za-z0-9_]+)/g, "[REDACTED_KEY]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED_PRIVATE_KEY]"],
  [/((?:pass(?:word)?|secret|token|api[_-]?key|authorization|signature|passwordHash|ciphertext)["']?\s*[:=]\s*["']?)[^\s"',}&]{4,}/gi, "$1[REDACTED]"],
];

export function redactSecrets(input: string): string {
  let output = input;
  for (const [pattern, replacement] of RULES) output = output.replace(pattern, replacement);
  return output;
}

/** Strips control characters/newlines from user-controlled values so they cannot forge log lines. */
export function logSafe(value: unknown, max = 200): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, max);
}
