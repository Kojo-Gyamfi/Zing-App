/**
 * Chat ids are deterministic: the two members' uids, sorted and joined with
 * "_". "Message yourself" is the same with one uid twice -- `${uid}_${uid}` --
 * a chat whose only member is its owner, sealed to their key alone.
 */
export function directChatId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

export function selfChatId(uid: string): string {
  return `${uid}_${uid}`;
}

export function isSelfChat(chatId: string, uid: string | null | undefined): boolean {
  return uid !== null && uid !== undefined && chatId === selfChatId(uid);
}

/** The other member of a direct chat, or null in a chat with yourself. */
export function peerOf(chatId: string, uid: string | null | undefined): string | null {
  return chatId.split('_').find((member) => member !== uid) ?? null;
}
