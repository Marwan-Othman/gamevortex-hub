import { describe, expect, it } from 'vitest';
import {
  buildBlobPathname,
  canonicalBlobUrl,
  checkGameFile,
  dedupeSlugs,
  getGameExtension,
  isValidBlobPathname,
  normalizeUploadSourceStatus,
  platformFromFileName,
  safeBlobFileName,
  slugify,
  titleFromFileName,
} from '../lib/game-upload-shared';

const HOST = 'https://abc123.public.blob.vercel-storage.com';

describe('game upload helpers', () => {
  it('detects compound and simple extensions', () => {
    expect(getGameExtension('Game.TAR.GZ')).toBe('.tar.gz');
    expect(getGameExtension('x.appimage')).toBe('.appimage');
    expect(getGameExtension('x.txt')).toBe('');
  });

  it('derives title and slug from the file name', () => {
    expect(titleFromFileName('Call-of-Duty.zip')).toBe('Call of Duty');
    expect(slugify(titleFromFileName('Call-of-Duty.zip'))).toBe('call-of-duty');
    expect(titleFromFileName('Minecraft.exe')).toBe('Minecraft');
    expect(titleFromFileName('my_game.tar.gz')).toBe('my game');
  });

  it('maps extensions to platforms', () => {
    expect(platformFromFileName('a.apk')).toBe('ANDROID');
    expect(platformFromFileName('a.obb')).toBe('ANDROID');
    expect(platformFromFileName('a.dmg')).toBe('MAC');
    expect(platformFromFileName('a.deb')).toBe('LINUX');
    expect(platformFromFileName('a.AppImage')).toBe('LINUX');
    expect(platformFromFileName('a.zip')).toBe('PC');
    expect(platformFromFileName('a.tar.gz')).toBe('PC');
  });

  it('validates game files', () => {
    expect(checkGameFile({ name: 'a.exe', size: 10 })).toBeNull();
    expect(checkGameFile({ name: 'a.txt', size: 10 })).toBe('UNSUPPORTED_EXTENSION');
    expect(checkGameFile({ name: 'a.exe', size: 0 })).toBe('EMPTY_FILE');
  });

  it('only accepts safe blob pathnames', () => {
    expect(isValidBlobPathname('games/files/1-a-game.zip', 'game')).toBe(true);
    expect(isValidBlobPathname('games/mods/1-a-mod.apk', 'mod')).toBe(true);
    expect(isValidBlobPathname('games/covers/1-a.png', 'cover')).toBe(true);
    expect(isValidBlobPathname('games/files/../secret.zip', 'game')).toBe(false);
    expect(isValidBlobPathname('other/files/a.zip', 'game')).toBe(false);
    expect(isValidBlobPathname('games/files/a.html', 'game')).toBe(false);
    expect(isValidBlobPathname('games/mods/a.zip', 'game')).toBe(false);
    expect(isValidBlobPathname('/games/files/a.zip', 'game')).toBe(false);
  });

  it('canonicalizes Blob URLs and rejects foreign ones', () => {
    expect(canonicalBlobUrl(`${HOST}/games/files/1-a-game.zip?download=1`, 'game')).toBe(`${HOST}/games/files/1-a-game.zip`);
    expect(canonicalBlobUrl('http://abc.public.blob.vercel-storage.com/games/files/a.zip', 'game')).toBeNull();
    expect(canonicalBlobUrl('https://evil.example.com/games/files/a.zip', 'game')).toBeNull();
    expect(canonicalBlobUrl('https://blob.vercel-storage.com.evil.com/games/files/a.zip', 'game')).toBeNull();
    expect(canonicalBlobUrl(`${HOST}/games/files/%2e%2e/a.zip`, 'game')).toBeNull();
    expect(canonicalBlobUrl(`${HOST}/other/a.zip`, 'game')).toBeNull();
    expect(canonicalBlobUrl(`${HOST}/games/mods/a.zip`, 'game')).toBeNull();
    expect(canonicalBlobUrl(42, 'game')).toBeNull();
  });

  it('only allows distributable source statuses for uploads', () => {
    expect(normalizeUploadSourceStatus('OPEN_SOURCE')).toBe('OPEN_SOURCE');
    expect(normalizeUploadSourceStatus('VERIFIED')).toBe('LICENSED_FOR_DISTRIBUTION');
    expect(normalizeUploadSourceStatus(undefined)).toBe('LICENSED_FOR_DISTRIBUTION');
  });

  it('builds upload pathnames that pass validation', () => {
    const pathname = buildBlobPathname('game', 'My Game (v2).zip', 'uuid');
    expect(isValidBlobPathname(pathname, 'game')).toBe(true);
    expect(safeBlobFileName('../../x.zip')).not.toContain('..');
  });

  it('dedupes slugs within a batch and against taken slugs', () => {
    expect(dedupeSlugs(['game', 'game', 'other'])).toEqual(['game', 'game-2', 'other']);
    expect(dedupeSlugs(['game'], new Set(['game']))).toEqual(['game-2']);
    expect(dedupeSlugs([''])).toEqual(['game-1']);
  });
});
