'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetItem, SheetTitle } from './Sheet';
import { coordinates, type SharedLocation } from '@/lib/location';

type Finding =
  | { state: 'finding' }
  | { state: 'found'; location: SharedLocation }
  | { state: 'failed'; reason: string };

/**
 * The composer's attach menu. Today it holds one thing, the current location;
 * it is a menu so more (polls, stickers) can join it.
 */
export function AttachSheet({
  onSendLocation,
  onClose,
}: {
  onSendLocation: (location: SharedLocation) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'menu' | 'location'>('menu');

  if (step === 'location') {
    return <LocationStep onSend={onSendLocation} onBack={() => setStep('menu')} onClose={onClose} />;
  }

  return (
    <Sheet label="Attach" onClose={onClose}>
      <SheetTitle>Share</SheetTitle>
      <ul className="flex flex-col">
        <SheetItem
          label="Location"
          hint="Where you are now, sealed in the message like any text"
          icon="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
          onClick={() => setStep('location')}
        />
      </ul>
    </Sheet>
  );
}

/**
 * Finds where the device is, shows it, and sends it only once confirmed --
 * a location is not something to share by accident.
 */
function LocationStep({
  onSend,
  onBack,
  onClose,
}: {
  onSend: (location: SharedLocation) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [finding, setFinding] = useState<Finding>({ state: 'finding' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      queueMicrotask(() => setFinding({ state: 'failed', reason: 'This browser can’t share a location.' }));
      return;
    }
    let live = true;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        live &&
        setFinding({
          state: 'found',
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          },
        }),
      (error) =>
        live &&
        setFinding({
          state: 'failed',
          reason:
            error.code === error.PERMISSION_DENIED
              ? 'Location is blocked for Zing. Allow it in your browser’s site settings, then try again.'
              : error.code === error.TIMEOUT
                ? 'Couldn’t find your location in time. Try again, ideally outdoors or with Wi-Fi on.'
                : 'Couldn’t find your location. Check that location is on for this device.',
        }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <Sheet label="Share your location" onClose={onClose}>
      <SheetTitle onBack={onBack}>Share your location</SheetTitle>
      <div className="space-y-3 px-2 pb-1">
        <div className="flex items-center gap-3 rounded-2xl bg-elevated p-3">
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
          <p className="min-w-0 text-[14px] leading-relaxed text-ink" aria-live="polite">
            {finding.state === 'finding'
              ? 'Finding where you are…'
              : finding.state === 'found'
                ? (
                    <>
                      <span className="block font-medium tabular-nums">{coordinates(finding.location)}</span>
                      <span className="block text-[12px] text-muted">
                        {finding.location.accuracy !== null
                          ? `Accurate to about ${Math.round(finding.location.accuracy)} m`
                          : 'Accuracy unknown'}
                      </span>
                    </>
                  )
                : finding.reason}
          </p>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          Sent end-to-end encrypted, like a message. It’s a one-off spot, not live tracking. No map is
          loaded here; the other person opens it in their maps app.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-xl bg-elevated text-[15px] font-medium text-ink"
          >
            Cancel
          </button>
          {finding.state === 'failed' ? (
            <button
              onClick={() => {
                setFinding({ state: 'finding' });
                setAttempt((count) => count + 1);
              }}
              className="h-11 flex-1 rounded-xl bg-zing text-[15px] font-semibold text-on-zing"
            >
              Try again
            </button>
          ) : (
            <button
              onClick={() => {
                if (finding.state !== 'found') return;
                onSend(finding.location);
                onClose();
              }}
              disabled={finding.state !== 'found'}
              className="h-11 flex-1 rounded-xl bg-zing text-[15px] font-semibold text-on-zing disabled:opacity-40"
            >
              Send this location
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
