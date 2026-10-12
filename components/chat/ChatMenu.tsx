'use client';

import { useState } from 'react';
import { MAX_PINNED } from '@/lib/db/schema';
import { BUBBLES, BUBBLE_SWATCHES, type BubbleColor, type ChatTheme, type Wallpaper } from '@/lib/appearance';
import type { MuteDuration } from '@/lib/mute';
import { WallpaperPicker } from '@/components/settings/WallpaperPicker';
import { ICONS, Sheet, SheetItem, SheetTitle } from './Sheet';
import { MutePicker } from './MutePicker';
import { DisappearingPicker, disappearingLabel } from './Disappearing';
import type { ExportFormat } from '@/lib/export';

type View = 'main' | 'mute' | 'disappearing' | 'theme' | 'block' | 'clear' | 'export';

const BUBBLE_NAMES: Record<BubbleColor, string> = {
  teal: 'Teal',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  rose: 'Rose',
  amber: 'Amber',
};

const MENU_ICONS = {
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4',
  theme: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.4-2a2 2 0 0 1 1.9-2.7H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  clear: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  close: 'M6 6l12 12M18 6 6 18',
} as const;

/**
 * The ⋮ menu inside a chat: everything that acts on the conversation as a
 * whole, in one place. Mute, pin, favourite, archive and the theme are this
 * user's own preferences; disappearing messages and blocking change the chat
 * for both. Clear chat is for this user only, and asks first.
 */
export function ChatMenu({
  name,
  canBlock,
  canMute = true,
  selfChat = false,
  blocked,
  muteStatus,
  disappearing,
  theme,
  defaultWallpaper,
  pinned,
  pinnedCount,
  favourite,
  archived,
  onContactInfo,
  onMute,
  onDisappearing,
  onTheme,
  onPin,
  onFavourite,
  onArchive,
  onBlock,
  onClear,
  onExport,
  onCloseChat,
  onClose,
}: {
  name: string;
  /** False for a deleted account: nobody to block. */
  canBlock: boolean;
  /** False in a chat with myself: nothing there ever sends a push. */
  canMute?: boolean;
  /** "Message yourself": nobody else to mention. */
  selfChat?: boolean;
  /** I have blocked them. */
  blocked: boolean;
  muteStatus: string | null;
  /** Seconds, 0 when off. */
  disappearing: number;
  theme: ChatTheme;
  /** The wallpaper from Settings, which "Default" stands for. */
  defaultWallpaper: Wallpaper;
  pinned: boolean;
  pinnedCount: number;
  favourite: boolean;
  archived: boolean;
  /** Undefined while there is no profile to show. */
  onContactInfo?: () => void;
  onMute: (duration: MuteDuration | null) => void;
  /** Undefined while the chat is blocked: the timer is then read-only. */
  onDisappearing?: (seconds: number) => void;
  onTheme: (patch: { wallpaper?: Wallpaper | null; bubble?: BubbleColor | null } | null) => void;
  onPin: (on: boolean) => void;
  onFavourite: (on: boolean) => void;
  onArchive: (on: boolean) => void;
  onBlock: (on: boolean) => void;
  onClear: () => void;
  /** Builds and saves the file; resolves false if the chat could not be read. */
  onExport?: (format: ExportFormat, onProgress: (count: number) => void) => Promise<boolean>;
  onCloseChat: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('main');
  const back = () => setView('main');
  const done = (action: () => void) => () => {
    action();
    onClose();
  };
  const pinFull = !pinned && pinnedCount >= MAX_PINNED;

  if (view === 'mute') {
    return (
      <Sheet label={`Mute ${name}`} onClose={onClose}>
        <SheetTitle onBack={back}>Mute notifications</SheetTitle>
        <MutePicker
          status={muteStatus}
          onChoose={(duration) => {
            onMute(duration);
            back();
          }}
        />
      </Sheet>
    );
  }

  if (view === 'disappearing') {
    return (
      <Sheet label="Disappearing messages" onClose={onClose}>
        <SheetTitle onBack={back}>Disappearing messages</SheetTitle>
        <div className="space-y-3 px-2 pb-1">
          <p className="text-[13px] leading-relaxed text-muted">
            {onDisappearing
              ? selfChat
                ? 'New notes vanish this long after you write them. Ones already here keep their own timer.'
                : 'New messages vanish for both of you this long after they’re sent. Either of you can change it. Messages already sent keep their own timer.'
              : 'The timer can’t be changed while this chat is blocked.'}
          </p>
          <DisappearingPicker value={disappearing} onChange={onDisappearing} />
        </div>
      </Sheet>
    );
  }

  if (view === 'theme') {
    const bubble = theme.bubble ?? null;
    return (
      <Sheet label="Chat theme and wallpaper" onClose={onClose}>
        <SheetTitle onBack={back}>Chat theme &amp; wallpaper</SheetTitle>
        <div className="space-y-4 px-2 pb-1">
          <p className="text-[13px] leading-relaxed text-muted">
            Only for this chat, and only you see it. Default follows Settings.
          </p>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">Your bubbles</p>
            <div role="radiogroup" aria-label="Bubble colour" className="flex flex-wrap gap-2.5">
              {[null, ...BUBBLES].map((choice) => {
                const selected = bubble === choice;
                return (
                  <button
                    key={choice ?? 'default'}
                    role="radio"
                    aria-checked={selected}
                    aria-label={choice ? BUBBLE_NAMES[choice] : 'Default bubble colour'}
                    onClick={() => !selected && onTheme({ bubble: choice })}
                    className={`grid size-10 place-items-center rounded-full border-2 transition-colors
                      ${selected ? 'border-zing' : 'border-transparent hover:border-line'}`}
                  >
                    {choice ? (
                      <span
                        className="size-7 rounded-full"
                        style={{ backgroundColor: BUBBLE_SWATCHES[choice] }}
                      />
                    ) : (
                      <span className="grid size-7 place-items-center rounded-full bg-elevated text-[10px] font-semibold text-muted">
                        Auto
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">Wallpaper</p>
            <WallpaperPicker
              value={theme.wallpaper ?? null}
              fallback={defaultWallpaper}
              onChange={(wallpaper) => onTheme({ wallpaper })}
            />
          </div>

          {(theme.wallpaper || theme.bubble) && (
            <button
              onClick={() => onTheme(null)}
              className="h-10 w-full rounded-xl bg-elevated text-[14px] font-medium text-ink transition-colors hover:bg-line"
            >
              Reset to default
            </button>
          )}
        </div>
      </Sheet>
    );
  }

  if (view === 'export' && onExport) {
    return <ExportStep name={name} onExport={onExport} onBack={back} onClose={onClose} />;
  }

  if (view === 'block' || view === 'clear') {
    const clearing = view === 'clear';
    return (
      <Sheet label={clearing ? 'Clear this chat?' : `Block ${name}?`} onClose={onClose}>
        <div role="alertdialog" aria-label={clearing ? 'Clear this chat?' : `Block ${name}?`} className="space-y-3 p-3">
          <p className="text-[16px] font-semibold text-ink">
            {clearing ? 'Clear this chat?' : `Block ${name}?`}
          </p>
          <p className="text-[14px] leading-relaxed text-muted">
            {clearing
              ? `Every message in this chat will be removed from your account, on all your devices. This can’t be undone.${selfChat ? '' : ` ${name} keeps their copy.`}`
              : 'Neither of you can send messages in this chat until you unblock, and they lose your phone number and contacts-only photo. Your chat history stays.'}
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={back}
              className="h-11 flex-1 rounded-xl bg-elevated text-[15px] font-medium text-ink transition-colors hover:bg-line"
            >
              Cancel
            </button>
            <button
              onClick={done(clearing ? onClear : () => onBlock(true))}
              className="h-11 flex-1 rounded-xl bg-danger text-[15px] font-semibold text-white"
            >
              {clearing ? 'Clear chat' : 'Block'}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet label={`Options for the chat with ${name}`} onClose={onClose}>
      <SheetTitle>{name}</SheetTitle>
      <ul className="flex flex-col">
        {onContactInfo && (
          <SheetItem
            label="Contact info"
            hint="Profile, nickname, phone number and encryption check"
            icon={MENU_ICONS.info}
            onClick={done(onContactInfo)}
          />
        )}
        {canMute && (
          <SheetItem
            label={muteStatus ? 'Muted' : 'Mute notifications'}
            hint={muteStatus ?? '8 hours, 1 week or always'}
            icon={muteStatus ? ICONS.mute : ICONS.unmute}
            onClick={() => setView('mute')}
          />
        )}
        <SheetItem
          label="Disappearing messages"
          hint={disappearingLabel(disappearing)}
          icon={MENU_ICONS.timer}
          onClick={() => setView('disappearing')}
        />
        <SheetItem
          label="Chat theme & wallpaper"
          hint={theme.wallpaper || theme.bubble ? 'Custom for this chat' : 'Default'}
          icon={MENU_ICONS.theme}
          onClick={() => setView('theme')}
        />
        {!archived && (
          <SheetItem
            label={pinned ? 'Unpin chat' : 'Pin chat'}
            hint={pinFull ? `You can pin up to ${MAX_PINNED} chats. Unpin one first.` : undefined}
            disabled={pinFull}
            icon={ICONS.pin}
            onClick={done(() => onPin(!pinned))}
          />
        )}
        <SheetItem
          label={favourite ? 'Remove from favourites' : 'Add to favourites'}
          icon={ICONS.favourite}
          onClick={done(() => onFavourite(!favourite))}
        />
        <SheetItem
          label={archived ? 'Unarchive chat' : 'Archive chat'}
          icon={ICONS.archive}
          onClick={done(() => onArchive(!archived))}
        />
        {canBlock && (
          <SheetItem
            label={blocked ? `Unblock ${name}` : `Block ${name}`}
            icon={MENU_ICONS.block}
            danger={!blocked}
            onClick={blocked ? done(() => onBlock(false)) : () => setView('block')}
          />
        )}
        {onExport && (
          <SheetItem
            label="Export chat"
            hint="Save it as a file on this device"
            icon="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"
            onClick={() => setView('export')}
          />
        )}
        <SheetItem
          label="Clear chat"
          hint="Removes every message, for you only"
          icon={MENU_ICONS.clear}
          danger
          onClick={() => setView('clear')}
        />
        {/* Phones have Back in the header; a wide screen keeps the chat open
            beside the list until it is closed. */}
        <SheetItem
          label="Close chat"
          icon={MENU_ICONS.close}
          className="hidden md:block"
          onClick={done(onCloseChat)}
        />
      </ul>
    </Sheet>
  );
}

/**
 * Export: pick a format, see the warning, save. The whole conversation is
 * read and decrypted on this device; the file it makes is not encrypted, so
 * that is said before it is made, not after.
 */
function ExportStep({
  name,
  onExport,
  onBack,
  onClose,
}: {
  name: string;
  onExport: (format: ExportFormat, onProgress: (count: number) => void) => Promise<boolean>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setFailed(false);
    setProgress(0);
    const ok = await onExport(format, setProgress).catch(() => false);
    setProgress(null);
    if (ok) onClose();
    else setFailed(true);
  }

  return (
    <Sheet label="Export chat" onClose={onClose}>
      <SheetTitle onBack={onBack}>Export chat</SheetTitle>
      <div className="space-y-3 px-2 pb-1">
        <p className="text-[13px] leading-relaxed text-muted">
          Every message in your chat with {name} is saved as a file on this device, decrypted here —
          Zing’s servers aren’t involved.
        </p>
        <div role="radiogroup" aria-label="File format" className="grid grid-cols-2 gap-2">
          {(
            [
              ['txt', 'Text (.txt)', 'Easy to read'],
              ['json', 'Data (.json)', 'For other apps'],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              role="radio"
              aria-checked={format === value}
              onClick={() => setFormat(value)}
              className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors
                ${format === value ? 'border-zing bg-zing/10' : 'border-line hover:border-muted'}`}
            >
              <span className="block text-[14px] font-medium text-ink">{label}</span>
              <span className="block text-[12px] text-muted">{hint}</span>
            </button>
          ))}
        </div>
        <p className="rounded-xl bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
          The file is <strong>not encrypted</strong>. Anyone who gets it can read the whole chat — keep
          it somewhere private.
        </p>
        {failed && (
          <p className="text-[12px] text-danger">Couldn’t read the chat. Check your connection and try again.</p>
        )}
        <button
          onClick={() => void run()}
          disabled={progress !== null}
          className="h-11 w-full rounded-xl bg-zing text-[15px] font-semibold text-on-zing disabled:opacity-60"
        >
          {progress === null ? 'Export' : `Collecting messages… ${progress}`}
        </button>
      </div>
    </Sheet>
  );
}
