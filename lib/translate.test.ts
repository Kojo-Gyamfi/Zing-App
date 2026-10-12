import { afterEach, describe, expect, it } from 'vitest';
import { canTranslate, translateMessage } from './translate';

type Scope = { Translator?: unknown; LanguageDetector?: unknown; window?: unknown };
const scope = globalThis as Scope;

/** Stand-ins for Chrome's on-device APIs. */
function fakeApis(options: { detected: string; confidence?: number; available?: boolean }) {
  scope.window = scope;
  scope.LanguageDetector = {
    availability: async () => 'available',
    create: async () => ({
      detect: async () => [{ detectedLanguage: options.detected, confidence: options.confidence ?? 0.9 }],
    }),
  };
  scope.Translator = {
    availability: async () => (options.available === false ? 'unavailable' : 'available'),
    create: async () => ({ translate: async (text: string) => `[en] ${text}` }),
  };
}

afterEach(() => {
  delete scope.Translator;
  delete scope.LanguageDetector;
  delete scope.window;
});

describe('translating on the device', () => {
  it('is offered only where the browser has the APIs', () => {
    expect(canTranslate()).toBe(false);
    fakeApis({ detected: 'fr' });
    expect(canTranslate()).toBe(true);
  });

  it('translates into my language and says from what', async () => {
    fakeApis({ detected: 'fr' });
    expect(await translateMessage('Bonjour', 'en')).toEqual({ state: 'done', text: '[en] Bonjour', from: 'fr' });
  });

  it('says so when it is already in my language, or the pair is missing, or unclear', async () => {
    fakeApis({ detected: 'en' });
    expect(await translateMessage('Hello', 'en')).toEqual({ state: 'same', from: 'en' });

    fakeApis({ detected: 'tw', available: false });
    expect((await translateMessage('Maakye', 'en')).state).toBe('failed');

    fakeApis({ detected: 'fr', confidence: 0.1 });
    expect(await translateMessage('ok', 'en')).toMatchObject({ state: 'failed' });
  });

  it('fails gently where the browser cannot translate at all', async () => {
    expect((await translateMessage('Bonjour', 'en')).state).toBe('failed');
  });
});
