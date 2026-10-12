/**
 * Translating a message, on this device: Chrome's built-in Translator and
 * LanguageDetector APIs, which run language models locally (downloaded once
 * per language pair -- the models, never the text). Where a browser lacks
 * them, "Translate" is simply not offered. Never a cloud translator: it would
 * read the message, which only the two people in the chat may do.
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

type TranslatorLike = { translate: (text: string) => Promise<string> };
type TranslatorApi = {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<Availability>;
  create: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<TranslatorLike>;
};
type DetectorApi = {
  availability: () => Promise<Availability>;
  create: () => Promise<{ detect: (text: string) => Promise<{ detectedLanguage: string; confidence: number }[]> }>;
};

function apis(): { translator: TranslatorApi; detector: DetectorApi } | null {
  const scope = globalThis as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi };
  return scope.Translator && scope.LanguageDetector
    ? { translator: scope.Translator, detector: scope.LanguageDetector }
    : null;
}

/** Whether this browser can translate on the device at all. */
export function canTranslate(): boolean {
  return typeof window !== 'undefined' && apis() !== null;
}

/** "en" from "en-GB": what messages are translated into. */
export function myLanguage(): string {
  return (typeof navigator === 'undefined' ? 'en' : navigator.language).split('-')[0].toLowerCase();
}

/** "French" for "fr", in my own language. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type Translation =
  | { state: 'working' }
  | { state: 'done'; text: string; from: string }
  | { state: 'same'; from: string }
  | { state: 'failed'; reason: string };

// Made once and reused, per API object (one per browser; tests swap them).
const translatorsFor = new WeakMap<TranslatorApi, Map<string, Promise<TranslatorLike>>>();
const detectors = new WeakMap<DetectorApi, ReturnType<DetectorApi['create']>>();

/**
 * The text in my language, with the language it came from. Must start from
 * a tap: the first use of a language pair downloads its model, and the
 * browser only allows that in response to the person asking.
 */
export async function translateMessage(text: string, target = myLanguage()): Promise<Translation> {
  const api = apis();
  if (!api) return { state: 'failed', reason: 'This browser can’t translate on the device.' };
  try {
    if (!detectors.has(api.detector)) detectors.set(api.detector, api.detector.create());
    const [best] = await (await detectors.get(api.detector)!).detect(text);
    const from = best && best.confidence > 0.4 ? best.detectedLanguage.split('-')[0] : null;
    if (!from || from === 'und') return { state: 'failed', reason: 'Couldn’t tell what language this is.' };
    if (from === target) return { state: 'same', from };

    const pair = { sourceLanguage: from, targetLanguage: target };
    if ((await api.translator.availability(pair)) === 'unavailable') {
      return {
        state: 'failed',
        reason: `${languageName(from)} to ${languageName(target)} isn’t available on this device.`,
      };
    }
    const key = `${from}>${target}`;
    if (!translatorsFor.has(api.translator)) translatorsFor.set(api.translator, new Map());
    const translators = translatorsFor.get(api.translator)!;
    if (!translators.has(key)) {
      const created = api.translator.create(pair);
      // A failed download is not kept: the next tap tries again.
      created.catch(() => translators.delete(key));
      translators.set(key, created);
    }
    const translated = await (await translators.get(key)!).translate(text);
    return { state: 'done', text: translated, from };
  } catch (cause) {
    detectors.delete(api.detector);
    return {
      state: 'failed',
      reason:
        cause instanceof Error && /download|network/i.test(cause.message)
          ? 'Couldn’t download the language. Check your connection and try again.'
          : 'Couldn’t translate this message.',
    };
  }
}
