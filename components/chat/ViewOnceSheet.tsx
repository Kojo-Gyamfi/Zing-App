'use client';

import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { FormattedText, ViewOnceIcon } from './MessageBubble';

/**
 * A view-once message, open. Opening it is what wipes it from the server:
 * `onOpened` runs as the sheet appears, and the text shown here is the copy
 * taken at that moment, gone for good once this closes.
 *
 * No web page can stop a screenshot -- browsers give pages no say over it,
 * and nothing stops a second phone's camera. So this makes one as hard to
 * take, and as useless to share, as a page can:
 *
 *  - the text is only in the page while it is held down (press and hold),
 *    so there is nothing on screen to capture between presses;
 *  - it closes for good the moment the page loses focus or is hidden --
 *    switching apps, the notification shade, a desktop snipping tool -- or a
 *    screenshot shortcut is pressed (Print Screen, Win+Shift+S, Cmd+Shift);
 *  - it cannot be selected, copied, dragged, long-pressed or printed;
 *  - the viewer's own @handle is drawn across it, so a capture that does
 *    get taken says who leaked it.
 */
export function ViewOnceSheet({
  text,
  from,
  viewer,
  onOpened,
  onClose,
}: {
  text: string;
  from: string;
  /** The person viewing ("@ama"), drawn across the text as a watermark. */
  viewer: string;
  onOpened: () => void;
  onClose: () => void;
}) {
  // Once, even if the parent re-renders while it is open.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    onOpened();
  }, [onOpened]);

  const [holding, setHolding] = useState(false);

  // Leaving the page, or reaching for a screenshot, ends the viewing.
  useEffect(() => {
    const close = () => {
      setHolding(false);
      onClose();
    };
    const onVisibility = () => document.visibilityState !== 'visible' && close();
    const onKey = (event: KeyboardEvent) => {
      const screenshot =
        event.key === 'PrintScreen' ||
        // Win+Shift+S, and macOS's Cmd+Shift+3/4/5: the modifiers come first.
        (event.shiftKey && event.metaKey) ||
        (event.key === 'Shift' && event.metaKey) ||
        (event.key === 'Meta' && event.shiftKey);
      if (screenshot) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey, true);
    // Print Screen on Windows often arrives only as a keyup.
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('blur', close);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [onClose]);

  const stop = (event: React.SyntheticEvent) => event.preventDefault();

  return (
    <Sheet label="View once message" onClose={onClose}>
      <div className="space-y-4 p-3" data-view-once>
        <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <ViewOnceIcon />
          View once · from {from}
        </p>

        <div
          role="button"
          tabIndex={0}
          aria-label={holding ? 'Release to hide' : 'Press and hold to view'}
          onPointerDown={(event) => {
            event.preventDefault();
            // Keeps the release reaching here if the finger slides off. Can
            // throw for a pointer the browser no longer tracks; holding still works.
            try {
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            } catch {
              // Ignored: see above.
            }
            setHolding(true);
          }}
          onPointerUp={() => setHolding(false)}
          onPointerCancel={() => setHolding(false)}
          onLostPointerCapture={() => setHolding(false)}
          onKeyDown={(event) => event.key === ' ' && setHolding(true)}
          onKeyUp={(event) => event.key === ' ' && setHolding(false)}
          onContextMenu={stop}
          onCopy={stop}
          onCut={stop}
          onDragStart={stop}
          className="relative grid min-h-40 touch-none place-items-center overflow-hidden rounded-2xl
            bg-elevated px-5 py-6 select-none [-webkit-touch-callout:none] [-webkit-user-drag:none]"
        >
          {holding ? (
            <>
              <p className="max-h-[50dvh] w-full overflow-hidden text-[16px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                <FormattedText text={text} />
              </p>
              <Watermark label={viewer} />
            </>
          ) : (
            <span className="flex flex-col items-center gap-2 text-center text-muted">
              <svg viewBox="0 0 24 24" className="size-8" aria-hidden="true">
                <path
                  d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.2-3l-2-3.5a1.5 1.5 0 0 1 2.6-1.5L9 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[14px] font-medium">Press and hold to view</span>
            </span>
          )}
        </div>

        <p className="text-[12px] leading-relaxed text-faint">
          It shows only while you hold it, and closes for good if you leave Zing or try a screenshot
          shortcut. No app can fully stop a screenshot or another phone’s camera, so your @handle is
          on it.
        </p>
        <button
          onClick={onClose}
          className="h-11 w-full rounded-xl bg-zing text-[15px] font-semibold text-on-zing"
        >
          Close — it’s gone after this
        </button>
      </div>
    </Sheet>
  );
}

/** The viewer's handle, tiled faintly across the text. */
function Watermark({ label }: { label: string }) {
  const stamp = `${label} · ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-center gap-x-8 gap-y-6 opacity-[0.13]">
        {Array.from({ length: 40 }, (_, index) => (
          <span key={index} className="text-[12px] font-semibold whitespace-nowrap text-ink">
            {stamp}
          </span>
        ))}
      </span>
    </span>
  );
}
