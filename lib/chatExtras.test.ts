import { describe, expect, it } from 'vitest';
import { cleanNickname, nameFor, toNicknames, MAX_NICKNAME } from './names';
import { directChatId, isSelfChat, peerOf, selfChatId } from './chatIds';
import { VIEW_ONCE_LABEL, viewOnceState } from './viewOnce';

describe('nicknames', () => {
  const kwame = { uid: 'k', displayName: 'Kwame Mensah' };

  it('shows my nickname for someone, their own name otherwise', () => {
    expect(nameFor(kwame, { k: 'Dad' }, '?')).toBe('Dad');
    expect(nameFor(kwame, {}, '?')).toBe('Kwame Mensah');
    expect(nameFor(null, { k: 'Dad' }, 'Deleted account')).toBe('Deleted account');
  });

  it('tidies what is typed, and a blank one means none', () => {
    expect(cleanNickname('  Big   Sis ')).toBe('Big Sis');
    expect(cleanNickname('   ')).toBeNull();
    expect(cleanNickname('x'.repeat(100))).toHaveLength(MAX_NICKNAME);
  });

  it('drops malformed entries read back from Firestore', () => {
    expect(toNicknames({ a: 'Mum', b: 7, c: '  ', d: ' Dad ' })).toEqual({ a: 'Mum', d: 'Dad' });
    expect(toNicknames(null)).toEqual({});
  });
});

describe('chat ids', () => {
  it('are the two uids sorted, or one uid twice for a chat with yourself', () => {
    expect(directChatId('bob', 'alice')).toBe('alice_bob');
    expect(directChatId('me', 'me')).toBe(selfChatId('me'));
    expect(selfChatId('me')).toBe('me_me');
  });

  it('know the peer, and that a chat with yourself has none', () => {
    expect(peerOf('alice_bob', 'alice')).toBe('bob');
    expect(peerOf('me_me', 'me')).toBeNull();
    expect(isSelfChat('me_me', 'me')).toBe(true);
    expect(isSelfChat('alice_bob', 'alice')).toBe(false);
    expect(isSelfChat('me_me', undefined)).toBe(false);
  });
});

describe('view once', () => {
  const message = (extra: Partial<Parameters<typeof viewOnceState>[0]> = {}) => ({
    viewOnce: true,
    viewed: false,
    text: 'secret',
    deleted: false,
    ...extra,
  });

  it('is ready for the recipient until opened, then gone for both', () => {
    expect(viewOnceState(message(), false)).toBe('ready');
    expect(viewOnceState(message(), true)).toBe('sent');
    expect(viewOnceState(message({ viewed: true, text: null }), false)).toBe('opened');
    expect(viewOnceState(message({ viewed: true, text: null }), true)).toBe('opened');
  });

  it('counts a message with no text left as opened, and leaves others alone', () => {
    expect(viewOnceState(message({ text: null }), false)).toBe('opened');
    expect(viewOnceState(message({ viewOnce: false }), false)).toBe('none');
    expect(viewOnceState(message({ deleted: true }), false)).toBe('none');
    expect(VIEW_ONCE_LABEL).toBe('View once message');
  });
});

describe('scanning a profile code', async () => {
  const { usernameFromScan } = await import('./qr');

  it('reads a profile link from any Zing deployment, or a bare @handle', () => {
    expect(usernameFromScan('https://zing.app/u/ama_k')).toBe('ama_k');
    expect(usernameFromScan('http://localhost:3000/u/Kofi99/')).toBe('kofi99');
    expect(usernameFromScan('  @Esi_B ')).toBe('esi_b');
  });

  it('refuses anything that is not a profile', () => {
    for (const text of [
      'https://zing.app/chats/abc',
      'https://zing.app/u/a',
      'https://zing.app/u/ama/extra',
      'javascript:alert(1)',
      'ftp://x.com/u/ama_k',
      'hello',
      '@no spaces',
      'https://zing.app/u/%E0%A4%A',
    ]) {
      expect(usernameFromScan(text)).toBeNull();
    }
  });
});
