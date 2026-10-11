import { describe, expect, it } from 'vitest';
import { canDownload, isDistributableStatus, resolveDownloadUrl, toPublicContent } from '../lib/downloads';

const BLOB = 'https://abc123.public.blob.vercel-storage.com/games/files/1-a/Game.apk';

describe('download helpers', () => {
  it('only distributable source statuses can be downloaded', () => {
    expect(isDistributableStatus('LICENSED_FOR_DISTRIBUTION')).toBe(true);
    expect(isDistributableStatus('OPEN_SOURCE')).toBe(true);
    expect(isDistributableStatus('NEEDS_SOURCE')).toBe(false);
    expect(isDistributableStatus('NEEDS_LICENSE')).toBe(false);
    expect(isDistributableStatus(null)).toBe(false);
  });

  it('strips query and hash from blob urls but keeps external queries', () => {
    expect(resolveDownloadUrl(`${BLOB}?download=1#x`)).toBe(BLOB);
    expect(resolveDownloadUrl('https://files.example.com/a.apk?token=1')).toBe('https://files.example.com/a.apk?token=1');
  });

  it('rejects unsafe or missing sources', () => {
    expect(resolveDownloadUrl(null)).toBeNull();
    expect(resolveDownloadUrl('http://files.example.com/a.apk')).toBeNull();
    expect(resolveDownloadUrl('javascript:alert(1)')).toBeNull();
    expect(resolveDownloadUrl('https://127.0.0.1/a.apk')).toBeNull();
    expect(resolveDownloadUrl('https://user:pw@files.example.com/a.apk')).toBeNull();
  });

  it('canDownload needs both a safe source and a distributable status', () => {
    expect(canDownload({ downloadSource: BLOB, sourceStatus: 'LICENSED_FOR_DISTRIBUTION' })).toBe(true);
    expect(canDownload({ downloadSource: BLOB, sourceStatus: 'NEEDS_LICENSE' })).toBe(false);
    expect(canDownload({ downloadSource: null, sourceStatus: 'OPEN_SOURCE' })).toBe(false);
  });

  it('toPublicContent never exposes the raw file url', () => {
    const result = toPublicContent({ id: '1', downloadSource: BLOB, sourceStatus: 'LICENSED_FOR_DISTRIBUTION' });
    expect(result).not.toHaveProperty('downloadSource');
    expect(result.hasDownload).toBe(true);
    expect(JSON.stringify(result)).not.toContain('blob.vercel-storage.com');
    expect(toPublicContent({ downloadSource: BLOB, sourceStatus: 'NEEDS_LICENSE' }).hasDownload).toBe(false);
  });
});
