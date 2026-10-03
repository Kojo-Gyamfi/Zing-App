import { describe, expect, it } from 'vitest';
import { finishUrl, looksLikeEmail, readFinishParams } from './linkParams';

describe('email sign-in link parameters', () => {
  it('round-trips intent and return path', () => {
    const url = finishUrl('https://zing.example', 'signin', '/u/kwame');
    expect(url.startsWith('https://zing.example/login/finish?')).toBe(true);
    expect(readFinishParams(url)).toEqual({ intent: 'signin', next: '/u/kwame' });
  });

  it('reads them from inside Firebase’s continueUrl', () => {
    const inner = finishUrl('https://zing.example', 'signup', '/settings');
    const outer = `https://zing.example/login/finish?mode=signIn&oobCode=abc&continueUrl=${encodeURIComponent(inner)}`;
    expect(readFinishParams(outer)).toEqual({ intent: 'signup', next: '/settings' });
  });

  it('drops a return path that would leave the site', () => {
    expect(finishUrl('https://zing.example', 'signup', '//evil.example')).not.toContain('next=');
    expect(readFinishParams('https://zing.example/login/finish?next=//evil.example').next).toBeNull();
    expect(readFinishParams('https://zing.example/login/finish?next=https://evil.example').next).toBeNull();
  });

  it('ignores an unknown intent and a malformed URL', () => {
    expect(readFinishParams('https://zing.example/login/finish?intent=admin').intent).toBeNull();
    expect(readFinishParams('not a url')).toEqual({ intent: null, next: null });
  });

  it('accepts any provider’s address, not just Gmail', () => {
    expect(looksLikeEmail('kojo@icloud.com')).toBe(true);
    expect(looksLikeEmail(' kojo@outlook.com ')).toBe(true);
    expect(looksLikeEmail('kojo@icloud')).toBe(false);
    expect(looksLikeEmail('kojo icloud.com')).toBe(false);
  });
});
