'use client';

import { useEffect, useMemo, useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { bubbleTime } from '@/lib/format';
import { DELETED_LABEL } from '@/lib/db/messages';
import { linkCard, type LinkCard } from '@/lib/links';
import { formatText, plainText, type FormattedRun } from '@/lib/formatting';
import type { ReactionChip } from '@/lib/reactions';
import { Ticks, type TickState } from './Ticks';
import type { DecryptedMessage } from '@/lib/db/schema';
import { VIEW_ONCE_LABEL, viewOnceState } from '@/lib/viewOnce';
import { languageName, type Translation } from '@/lib/translate';
import { coordinates, mapsLink, parseLocation, type SharedLocation } from '@/lib/location';

/** How far a bubble must be dragged right before letting go counts as "reply". */
const SWIPE_TO_REPLY = 56;
const LONG_PRESS_MS = 450;

/** A circle with a 1 in it: WhatsApp's view-once mark. */
export function ViewOnceIcon({ className = 'size-4 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 2.2" />
      <path d="M10.5 9.5 12.5 8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** WhatsApp's marker for a message that was forwarded rather than typed. */
export function ForwardedLabel() {
  return (
    <span className="mb-0.5 flex items-center gap-1 text-[12px] text-muted italic">
      <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
        <path
          d="M14 8l5 4-5 4M19 12h-9a5 5 0 0 0-5 5v1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Forwarded
    </span>
  );
}

const CARD_ICONS: Record<LinkCard['kind'], string> = {
  video: 'M4 6h16v12H4zM10 9.5v5l4.5-2.5z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  map: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

/**
 * One run of formatted text (lib/formatting.ts), innermost first: the search
 * highlight, then code, emphasis, and the link around the lot.
 */
function Run({ run }: { run: FormattedRun }) {
  let node: React.ReactNode = run.text;
  if (run.match) node = <mark className="rounded-sm bg-zing/40 text-ink">{node}</mark>;
  if (run.code) {
    node = (
      <code className="rounded bg-inset px-1 py-px font-mono text-[0.9em] break-all whitespace-pre-wrap">
        {node}
      </code>
    );
  }
  if (run.strike) node = <s>{node}</s>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong className="font-semibold">{node}</strong>;
  if (run.href) {
    node = (
      <a
        href={run.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        // A tap on a link is not the start of a long-press.
        onPointerDown={(event) => event.stopPropagation()}
        className="break-all text-zing-soft underline underline-offset-2"
      >
        {node}
      </a>
    );
  }
  return node;
}

/** A message body with its formatting, links and search hits. */
export function FormattedText({ text, search = '' }: { text: string; search?: string }) {
  const location = useMemo(() => parseLocation(text), [text]);
  const runs = useMemo(() => (location ? [] : formatText(text, search)), [location, text, search]);
  if (location) return <LocationCard location={location} />;
  return runs.map((run, index) => <Run key={index} run={run} />);
}

/**
 * A shared location: a pin, the coordinates and how precise they are, and a
 * link to open them in the maps app. Deliberately no map drawn here -- the
 * tiles would come from a map server, which would learn where this is.
 */
export function LocationCard({ location }: { location: SharedLocation }) {
  return (
    <a
      href={mapsLink(location)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      // A tap on the card is not the start of a long-press.
      onPointerDown={(event) => event.stopPropagation()}
      className="my-0.5 flex min-w-56 items-center gap-3 rounded-xl bg-inset p-2.5 text-left no-underline"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-zing/15 text-zing">
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
          <path
            d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-ink">Location</span>
        <span className="block truncate text-[12px] text-muted tabular-nums">{coordinates(location)}</span>
        <span className="block text-[12px] font-medium text-zing-soft">
          Open in Maps
          {location.accuracy !== null && (
            <span className="font-normal text-muted"> · within {Math.max(1, Math.round(location.accuracy))} m</span>
          )}
        </span>
      </span>
    </a>
  );
}

/**
 * The card under a message's first link, made from the URL alone -- no
 * request to the site, from either phone (see lib/links.ts). The host is the
 * real one, so a link whose text pretends to be somewhere else is caught out.
 */
function LinkPreview({ card }: { card: LinkCard }) {
  return (
    <a
      href={card.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      onPointerDown={(event) => event.stopPropagation()}
      className="mt-1.5 flex items-center gap-2.5 rounded-lg bg-inset px-2.5 py-2 text-left"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-inset text-muted">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            d={CARD_ICONS[card.kind]}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{card.title}</span>
        <span className="block truncate text-[12px] text-muted">{card.host}</span>
      </span>
    </a>
  );
}

export type Quote = {
  author: string;
  /** Null when the quoted message is deleted, undecryptable, or not loaded. */
  text: string | null;
  deleted: boolean;
};

export function MessageBubble({
  message,
  mine,
  tick,
  tailed,
  quote,
  highlighted,
  reactions = [],
  starred = false,
  search = '',
  onReply,
  onMenu,
  onQuoteClick,
  onReactionClick,
  onRetry,
  onDiscard,
  onOpenViewOnce,
  selecting = false,
  selected = false,
  onToggleSelect,
  translation,
  onHideTranslation,
}: {
  message: DecryptedMessage;
  mine: boolean;
  tick: TickState;
  /** Last in a run from the same sender -- only that one gets the tail corner. */
  tailed: boolean;
  /** The message this one replies to, resolved from what is loaded locally. */
  quote?: Quote | null;
  /** Briefly true after jumping here from a quote or a search hit. */
  highlighted?: boolean;
  reactions?: ReactionChip[];
  starred?: boolean;
  /** The in-chat search query; matches in the text are marked. */
  search?: string;
  onReply?: () => void;
  onMenu?: () => void;
  onQuoteClick?: () => void;
  /** Tapping the reaction chips: takes mine back, if I reacted. */
  onReactionClick?: () => void;
  /** Only used for failed messages. */
  onRetry?: () => void;
  onDiscard?: () => void;
  /** A view-once message of theirs, not opened yet: open it. */
  onOpenViewOnce?: () => void;
  /**
   * Selecting several messages, WhatsApp style: a tap anywhere on the row
   * picks or drops this one, instead of opening links, quotes or the menu.
   */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** This message in my language, translated on this device (lib/translate.ts). */
  translation?: Translation;
  onHideTranslation?: () => void;
}) {
  const x = useMotionValue(0);
  // The reply arrow fades in as the bubble is pulled towards the threshold.
  const arrowOpacity = useTransform(x, [0, SWIPE_TO_REPLY], [0, 1]);
  const arrowScale = useTransform(x, [0, SWIPE_TO_REPLY], [0.6, 1]);

  // Long-press opens the action menu on touch; right-click does on desktop.
  // iOS Safari never fires contextmenu for a long-press, hence the timer.
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  function cancelPress() {
    clearTimeout(pressTimer.current);
    pressStart.current = null;
  }

  // A bubble removed mid-press (deleted, expired) must not open a menu after.
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  // Swipe-to-reply needs something to quote; the menu only needs a real
  // message, so a "deleted" placeholder can still be deleted for me.
  const interactive = !message.failed && !message.deleted && !selecting;
  const hasMenu = !message.failed && !selecting;
  const showReactions = reactions.length > 0 && !message.deleted;
  const viewOnce = viewOnceState(message, mine);
  // A view-once message's text only ever shows in its own viewer.
  const sharedLocation = useMemo(() => parseLocation(message.text), [message.text]);
  const runs = useMemo(
    () =>
      message.text && !message.viewOnce && !sharedLocation ? formatText(message.text, search) : [],
    [message.text, message.viewOnce, sharedLocation, search],
  );
  // The first link outside code, which formatText has already picked out.
  const firstHref = runs.find((run) => run.href)?.href;
  const card = useMemo(() => (firstHref ? linkCard(firstHref) : null), [firstHref]);

  return (
    <motion.div
      id={`m-${message.id}`}
      // The "zing": messages arrive with a short flick rather than a fade.
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`relative flex w-full items-center rounded-xl transition-colors
        ${selecting ? 'cursor-pointer duration-150' : 'duration-700'}
        ${mine ? 'justify-end' : 'justify-start'}
        ${highlighted || selected ? 'bg-zing/15' : ''}
        ${showReactions ? 'mb-4' : ''}`}
      // While selecting, the whole row is one target: captured here so links,
      // quotes and "Tap to view" inside do not also act.
      onClickCapture={
        selecting && !message.failed
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleSelect?.();
            }
          : undefined
      }
      onContextMenu={
        selecting
          ? (event) => {
              event.preventDefault();
              if (!message.failed) onToggleSelect?.();
            }
          : undefined
      }
      role={selecting ? 'checkbox' : undefined}
      aria-checked={selecting ? selected : undefined}
      aria-label={selecting ? (selected ? 'Selected message' : 'Select message') : undefined}
    >
      {selecting && !message.failed && (
        <span
          aria-hidden="true"
          className={`absolute left-1 grid size-5 place-items-center rounded-full border-2 transition-colors
            ${selected ? 'border-zing bg-zing text-on-zing' : 'border-muted'}`}
        >
          {selected && (
            <svg viewBox="0 0 24 24" className="size-3.5">
              <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      <motion.div
        drag={interactive ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.6 }}
        dragSnapToOrigin
        style={{ x }}
        onDragStart={cancelPress}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_TO_REPLY) onReply?.();
        }}
        onPointerDown={(event) => {
          if (!hasMenu || event.pointerType === 'mouse') return;
          pressStart.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            pressStart.current = null;
            navigator.vibrate?.(10);
            onMenu?.();
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const start = pressStart.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
            cancelPress();
          }
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          if (!hasMenu) return;
          event.preventDefault();
          cancelPress();
          onMenu?.();
        }}
        // pan-y keeps vertical scrolling native while the bubble owns
        // horizontal drags; no-callout stops iOS's own long-press menu.
        className={`group relative max-w-[78%] touch-pan-y px-3 py-2 text-(length:--chat-text) leading-snug
          ${selecting && !mine ? 'ml-8' : ''}
          select-none [-webkit-touch-callout:none] md:select-text
          ${mine ? 'bg-bubble-out text-ink' : 'bg-bubble-in text-ink'}
          ${
            mine
              ? `rounded-2xl ${tailed ? 'rounded-br-sm' : ''}`
              : `rounded-2xl ${tailed ? 'rounded-bl-sm' : ''}`
          }`}
      >
        {/* Rides along with the bubble, just off its left edge. */}
        {interactive && (
          <motion.span
            aria-hidden="true"
            style={{ opacity: arrowOpacity, scale: arrowScale }}
            className="pointer-events-none absolute top-1/2 right-full mr-2 grid size-8 -translate-y-1/2
              place-items-center rounded-full bg-elevated text-muted"
          >
            <svg viewBox="0 0 24 24" className="size-4">
              <path
                d="M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.span>
        )}

        {message.forwarded && <ForwardedLabel />}

        {quote && (
          <button
            type="button"
            onClick={onQuoteClick}
            className="mb-1.5 block w-full rounded-lg border-l-[3px] border-zing bg-inset
              px-2.5 py-1.5 text-left"
          >
            {quote.author && (
              <span className="block text-[12px] font-semibold text-zing">{quote.author}</span>
            )}
            <span className="line-clamp-2 text-[13px] text-muted">
              {quote.deleted ? (
                <em>{DELETED_LABEL}</em>
              ) : (
                (quote.text !== null ? plainText(quote.text) : <em>Original message not loaded</em>)
              )}
            </span>
          </button>
        )}

        {message.deleted ? (
          <span className="flex items-center gap-1.5 text-muted italic">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {mine ? 'You deleted this message' : DELETED_LABEL}
          </span>
        ) : viewOnce !== 'none' ? (
          viewOnce === 'ready' ? (
            <button
              type="button"
              onClick={onOpenViewOnce}
              // Opening is a tap of its own, not the start of a long-press.
              onPointerDown={(event) => event.stopPropagation()}
              className="flex items-center gap-2 py-0.5 text-left font-medium text-zing-soft"
            >
              <ViewOnceIcon />
              {VIEW_ONCE_LABEL} · Tap to view
            </button>
          ) : (
            <span className="flex items-center gap-2 py-0.5 text-muted">
              <ViewOnceIcon />
              {viewOnce === 'opened' ? 'Opened' : VIEW_ONCE_LABEL}
            </span>
          )
        ) : message.text === null ? (
          <span className="flex items-center gap-1.5 text-muted italic">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path
                d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            Can&apos;t be decrypted on this device
          </span>
        ) : (
          <>
            {sharedLocation ? (
              <LocationCard location={sharedLocation} />
            ) : (
              <span className="break-words whitespace-pre-wrap">
                {runs.map((run, index) => (
                  <Run key={index} run={run} />
                ))}
              </span>
            )}
            {card && <LinkPreview card={card} />}
            {translation && (
              <span className="mt-1.5 block border-t border-ink/10 pt-1.5" aria-live="polite">
                {translation.state === 'done' && (
                  <span className="block break-words whitespace-pre-wrap">
                    <FormattedText text={translation.text} />
                  </span>
                )}
                <span className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-muted">
                  <span className="italic">
                    {translation.state === 'working'
                      ? 'Translating on this device…'
                      : translation.state === 'done'
                        ? `Translated from ${languageName(translation.from)}`
                        : translation.state === 'same'
                          ? `Already in ${languageName(translation.from)}`
                          : translation.reason}
                  </span>
                  {translation.state !== 'working' && (
                    <button
                      type="button"
                      onClick={onHideTranslation}
                      onPointerDown={(event) => event.stopPropagation()}
                      className="font-medium text-zing-soft"
                    >
                      Hide
                    </button>
                  )}
                </span>
              </span>
            )}
          </>
        )}

        {message.failed ? (
          <span className="mt-1 flex items-center justify-end gap-3 text-[12px]">
            <span className="text-danger">Not sent</span>
            <button onClick={onRetry} className="font-medium text-zing">
              Retry
            </button>
            <button onClick={onDiscard} className="text-muted">
              Delete
            </button>
          </span>
        ) : (
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
            {starred && (
              <svg viewBox="0 0 24 24" className="size-3" role="img" aria-label="Starred">
                <path
                  d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                  fill="currentColor"
                />
              </svg>
            )}
            {message.edited && <span>Edited</span>}
            {bubbleTime(message.createdAt)}
            {mine && !message.deleted && <Ticks state={tick} />}
          </span>
        )}

        {/* Desktop: right-click is not discoverable, so hovering a bubble shows
            an arrow that opens the same menu, as on WhatsApp Web. Touch keeps
            long-press -- there is no hover to reveal it. */}
        {hasMenu && (
          <button
            type="button"
            onClick={onMenu}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="Message options"
            // A fade in the bubble's own colour, so the text it sits over
            // melts away under the arrow instead of showing through it.
            className={`absolute top-0.5 right-0.5 hidden h-7 w-11 items-center justify-end rounded-tr-2xl
              bg-linear-to-l from-55% to-transparent pr-1.5 text-muted opacity-0 transition-opacity
              group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 md:flex
              ${mine ? 'from-bubble-out' : 'from-bubble-in'}`}
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Hangs off the bottom edge, WhatsApp style. */}
        {showReactions && (
          <button
            type="button"
            onClick={onReactionClick}
            aria-label={`Reactions: ${reactions
              .map((chip) => `${chip.emoji} ${chip.count}${chip.mine ? ', including yours' : ''}`)
              .join('; ')}`}
            className={`absolute -bottom-4 flex h-6 items-center gap-0.5 rounded-full border border-void
              bg-elevated px-1.5 text-[13px] leading-none shadow-sm shadow-black/40
              ${mine ? 'right-2' : 'left-2'}`}
          >
            {reactions.map((chip) => (
              <span key={chip.emoji}>{chip.emoji}</span>
            ))}
            {reactions.reduce((total, chip) => total + chip.count, 0) > 1 && (
              <span className="ml-0.5 text-[11px] text-muted">
                {reactions.reduce((total, chip) => total + chip.count, 0)}
              </span>
            )}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
