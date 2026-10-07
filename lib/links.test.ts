import { describe, expect, it } from 'vitest';
import { firstLinkCard, linkCard, splitLinks } from './links';

describe('splitLinks', () => {
  it('finds http(s) and www. links, leaving the rest as text', () => {
    expect(splitLinks('see https://example.com/a and www.zing.app now')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ' and ' },
      { text: 'www.zing.app', href: 'https://www.zing.app/' },
      { text: ' now' },
    ]);
  });

  it('leaves trailing punctuation out of the link', () => {
    expect(splitLinks('Look: https://example.com/page.')).toEqual([
      { text: 'Look: ' },
      { text: 'https://example.com/page', href: 'https://example.com/page' },
      { text: '.' },
    ]);
  });

  it('keeps a bracket that belongs to the URL', () => {
    const runs = splitLinks('(https://en.wikipedia.org/wiki/Accra_(city))');
    expect(runs[1].href).toBe('https://en.wikipedia.org/wiki/Accra_(city)');
    expect(runs[2].text).toBe(')');
  });

  it('never links other schemes', () => {
    expect(splitLinks('javascript:alert(1) data:text/html,hi')).toEqual([
      { text: 'javascript:alert(1) data:text/html,hi' },
    ]);
  });

  it('returns the text untouched when there is no link', () => {
    expect(splitLinks('no links here')).toEqual([{ text: 'no links here' }]);
  });
});

describe('linkCard', () => {
  it('titles a page from its path', () => {
    expect(linkCard('https://www.example.com/2026/10/how-to-cook-jollof.html')).toMatchObject({
      host: 'example.com',
      title: 'How to cook jollof',
      kind: 'link',
    });
  });

  it('falls back to the host', () => {
    expect(linkCard('https://example.com/').title).toBe('example.com');
    expect(linkCard('https://example.com/a8f3k2l9q0w1e2r3t4').title).toBe('example.com');
  });

  it('recognises a few sites', () => {
    expect(linkCard('https://youtu.be/dQw4w9WgXcQ').kind).toBe('video');
    expect(linkCard('https://github.com/vercel/next.js/issues/1').title).toBe('vercel/next.js');
  });

  it('shows a look-alike host as the punycode it really is', () => {
    expect(linkCard('https://аpple.com/login').host).toBe('xn--pple-43d.com');
  });

  it('takes the first link in a message', () => {
    expect(firstLinkCard('a https://one.com/first then https://two.com')?.host).toBe('one.com');
    expect(firstLinkCard('nothing')).toBeNull();
  });
});
