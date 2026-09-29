import { afterEach, describe, expect, it } from 'vitest';
import { decryptDigitalKey, encryptDigitalKey, keyFingerprint } from '../lib/digital-keys';

const previousSecret = process.env.DIGITAL_KEY_ENCRYPTION_SECRET;
const secret = 'development-only-digital-key-secret-at-least-32-chars';

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DIGITAL_KEY_ENCRYPTION_SECRET;
  else process.env.DIGITAL_KEY_ENCRYPTION_SECRET = previousSecret;
});

describe('digital-key encryption', () => {
  it('encrypts a key without leaving the plaintext in ciphertext and decrypts it correctly', () => {
    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = secret;
    const code = 'ABCD-1234-EFGH-5678';
    const ciphertext = encryptDigitalKey(code);

    expect(ciphertext).not.toContain(code);
    expect(decryptDigitalKey(ciphertext)).toBe(code);
  });

  it('creates the same fingerprint for equivalent trimmed keys', () => {
    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = secret;

    expect(keyFingerprint('ABCD-1234')).toBe(keyFingerprint('  ABCD-1234  '));
  });

  it('rejects ciphertext when a different encryption secret is configured', () => {
    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = secret;
    const ciphertext = encryptDigitalKey('ABCD-1234');
    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = 'another-development-key-that-is-at-least-32-chars';

    expect(() => decryptDigitalKey(ciphertext)).toThrow();
  });

  it('rejects encryption when the secret is missing or too short', () => {
    delete process.env.DIGITAL_KEY_ENCRYPTION_SECRET;
    expect(() => encryptDigitalKey('ABCD-1234')).toThrow('DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED');

    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = 'too-short';
    expect(() => keyFingerprint('ABCD-1234')).toThrow('DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED');
  });

  it('rejects truncated ciphertext', () => {
    process.env.DIGITAL_KEY_ENCRYPTION_SECRET = secret;
    expect(() => decryptDigitalKey('short')).toThrow('DIGITAL_KEY_CIPHERTEXT_INVALID');
  });
});
