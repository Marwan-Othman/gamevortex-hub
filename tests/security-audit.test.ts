import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWeakSecret } from '../lib/secret-strength';
import { logSafe, redactSecrets } from '../lib/redact';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', '.next', '.git', 'public', 'package-lock.json']);

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|json|yml|yaml|md|example|css)$/.test(entry) || entry.startsWith('.env') || entry === 'Dockerfile') out.push(full);
  }
  return out;
}

describe('isWeakSecret', () => {
  it('rejects short, placeholder and low-entropy values', () => {
    expect(isWeakSecret('short')).toBe(true);
    expect(isWeakSecret('replace-with-at-least-32-random-characters')).toBe(true);
    expect(isWeakSecret('REPLACE_WITH_64_PLUS_RANDOM_CHARACTERS')).toBe(true);
    expect(isWeakSecret('a'.repeat(64))).toBe(true);
    expect(isWeakSecret(undefined)).toBe(true);
  });
  it('accepts a random value', () => {
    expect(isWeakSecret('q8Zk2vXr9LmT4bYw7NcHj1PdFgS6eAu3KoVi0RtB5xE=')).toBe(false);
  });
});

describe('redactSecrets / logSafe', () => {
  it('removes connection strings, bearer tokens, keys, hashes and JWTs', () => {
    const text = [
      'connect postgresql://app:hunter2@db.internal:5432/gv failed',
      'Authorization: Bearer abcdefghijklmnop1234',
      'key sk_live_abcdefghijkl1234 and whsec_abcdefghijkl1234',
      'hash scrypt$00aa11bb$deadbeefdeadbeef',
      'jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
      'gvh_live_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      'password: "correct-horse-battery"',
    ].join('\n');
    const out = redactSecrets(text);
    for (const leaked of ['hunter2', 'abcdefghijklmnop1234', 'sk_live_abcdefghijkl1234', 'deadbeefdeadbeef', 'c2lnbmF0dXJl', 'correct-horse-battery', 'abcdefghijklmnopqrstuvwxyz0123456789']) {
      expect(out).not.toContain(leaked);
    }
  });
  it('logSafe strips newlines so user input cannot forge log lines', () => {
    expect(logSafe('a\nb\r\nc')).toBe('a b c');
  });
});

describe('repository secret hygiene', () => {
  const files = walk(ROOT);
  const TOKEN = /(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9a-zA-Z]{10,}|whsec_[0-9a-zA-Z]{10,}|ghp_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|vercel_blob_rw_[A-Za-z0-9_]+)/;

  it('contains no real-looking credentials', () => {
    const offenders = files
      .filter((file) => !file.endsWith('security-audit.test.ts') && !file.endsWith('redact.ts'))
      .filter((file) => TOKEN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('never exposes secret-like variables through NEXT_PUBLIC_', () => {
    const offenders = files
      .filter((file) => !file.endsWith('security-audit.test.ts'))
      .filter((file) => /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(readFileSync(file, 'utf8').replace(/Never use NEXT_PUBLIC_\.?/g, '').replace(/\(KEY\|SECRET\|TOKEN\|PASSWORD\)/g, '')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('.gitignore keeps real env files and private keys out of git', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    for (const rule of ['.env', '.env.*', '!.env.example', '*.pem', '*.key']) expect(ignore).toContain(rule);
  });

  it('env examples contain only empty values or obvious placeholders for secrets', () => {
    for (const name of ['.env.example', '.env.production.example']) {
      const lines = readFileSync(join(ROOT, name), 'utf8').split('\n');
      for (const line of lines) {
        const match = /^([A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY|PASSWORD))\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
        if (!match || !match[2]) continue;
        expect(isWeakSecret(match[2], 1) || /replace|change|example/i.test(match[2]), `${name}: ${match[1]} must be empty or a placeholder`).toBe(true);
      }
    }
  });

  it('no dangerouslySetInnerHTML / eval anywhere in app code', () => {
    const offenders = files
      .filter((file) => /\/(app|components|lib)\//.test(file) && /\.(ts|tsx)$/.test(file))
      .filter((file) => /dangerouslySetInnerHTML|\beval\(|new Function\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('every raw SQL call uses the parameterised Prisma.sql tag', () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => /\.(ts|mjs)$/.test(f) && !f.includes('/tests/'))) {
      const source = readFileSync(file, 'utf8');
      if (/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/.test(source)) offenders.push(relative(ROOT, file));
      for (const match of source.matchAll(/\$(?:queryRaw|executeRaw)\(\s*([^)\s]+)/g)) {
        if (!match[1].startsWith('Prisma.sql')) offenders.push(`${relative(ROOT, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
