/**
 * Profile links: zing.app/u/{username}. They carry only the @username, which
 * is already public; whoever opens one gets the profile and a Message button,
 * never the phone number.
 */
export function profileLink(username: string): string {
  return `${window.location.origin}/u/${username}`;
}

/**
 * Hand a profile link to the system share sheet, or copy it where there is
 * none. 'copied' is worth telling the user about; the others are not.
 */
export async function shareProfile(person: {
  username: string;
  displayName: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  const url = profileLink(person.username);
  const text = `Chat with ${person.displayName} (@${person.username}) on Zing`;

  if (navigator.share) {
    try {
      await navigator.share({ title: person.displayName, text, url });
    } catch {
      // Dismissed the share sheet; nothing to do.
    }
    return 'shared';
  }

  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    return 'copied';
  } catch {
    // Clipboard blocked too; nothing more we can do without a share target.
    return 'failed';
  }
}
