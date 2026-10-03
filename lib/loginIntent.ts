'use client';

/**
 * Which login button was pressed, carried across Google's redirect.
 *
 * Both buttons lead to the same sign-in choices. The difference only matters
 * when someone taps "I already have an account" but signs in with an account
 * that has no Zing profile: onboarding then says so, instead of silently
 * starting sign-up.
 */
export type LoginIntent = 'signup' | 'signin';

const KEY = 'zing:loginIntent';

export function setLoginIntent(intent: LoginIntent): void {
  try {
    sessionStorage.setItem(KEY, intent);
  } catch {
    // Only affects wording on the next screen.
  }
}

export function getLoginIntent(): LoginIntent | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === 'signup' || value === 'signin' ? value : null;
  } catch {
    // Server render, or storage blocked.
    return null;
  }
}

export function clearLoginIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
