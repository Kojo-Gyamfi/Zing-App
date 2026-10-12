'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from '@/lib/store/account';
import {
  ignoreKey,
  proofread,
  readDictionary,
  resolveDialect,
  warmUp,
  writeDictionary,
  type Issue,
} from '@/lib/proofread';

const PAUSE_MS = 450;
// Ignored for this session, on this device: "not now", not "never".
const ignoredThisSession = new Set<string>();

/**
 * Spelling and grammar issues in the text being typed, checked on this
 * device (lib/proofread.ts) a moment after typing pauses. While the text
 * changes, issues before the change stay put; the rest wait for the next
 * check rather than underline letters that have moved.
 */
export function useProofread(text: string, enabled: boolean) {
  const uid = useAccount((state) => state.owner);
  const settings = useAccount((state) => state.settings.proofread);
  const on = enabled && settings.on && uid !== null;
  const dialect = useMemo(
    () => resolveDialect(settings.dialect, typeof navigator === 'undefined' ? 'en' : navigator.language),
    [settings.dialect],
  );

  // My dictionary, kept per account: a switch of account reads the new one.
  const [dictionary, setDictionary] = useState<{ uid: string | null; words: string[] }>(() => ({
    uid,
    words: uid ? readDictionary(uid) : [],
  }));
  const words = useMemo(
    () => (dictionary.uid === uid ? dictionary.words : uid ? readDictionary(uid) : []),
    [dictionary, uid],
  );
  const [checked, setChecked] = useState<{ text: string; issues: Issue[] }>({ text: '', issues: [] });
  const [ignoredCount, setIgnoredCount] = useState(0);
  const version = useRef(0);

  useEffect(() => {
    if (!on) return;
    const mine = ++version.current;
    const timer = setTimeout(() => {
      void proofread(text, { dialect, words, ignored: ignoredThisSession })
        .then((issues) => {
          if (mine === version.current) setChecked({ text, issues });
        })
        .catch(() => undefined);
    }, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, on, dialect, words, ignoredCount]);

  // Issues valid for the text as it is now: all of them if it has not changed
  // since the check, otherwise only those wholly before the first change.
  const issues = useMemo(() => {
    if (!on) return [];
    if (checked.text === text) return checked.issues;
    let same = 0;
    while (same < text.length && same < checked.text.length && text[same] === checked.text[same]) same++;
    return checked.issues.filter((issue) => issue.end < same);
  }, [on, checked, text]);

  const ignore = useCallback((issue: Issue) => {
    ignoredThisSession.add(ignoreKey(issue.text, issue.message));
    setChecked((current) => ({
      ...current,
      issues: current.issues.filter((other) => ignoreKey(other.text, other.message) !== ignoreKey(issue.text, issue.message)),
    }));
    setIgnoredCount((count) => count + 1);
  }, []);

  /** Accept a word for good, on this device: it stops being a mistake. */
  const addWord = useCallback(
    (issue: Issue) => {
      if (!uid) return;
      const next = [...new Set([...readDictionary(uid), issue.text])];
      writeDictionary(uid, next);
      setDictionary({ uid, words: next });
      setChecked((current) => ({
        ...current,
        issues: current.issues.filter((other) => other.text.toLowerCase() !== issue.text.toLowerCase()),
      }));
    },
    [uid],
  );

  /** Fetch the engine before the first check needs it. */
  const prepare = useCallback(() => {
    if (on) warmUp();
  }, [on]);

  return { on, issues, ignore, addWord, prepare };
}
