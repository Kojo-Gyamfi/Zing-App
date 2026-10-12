'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usernameFromScan } from '@/lib/qr';

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/**
 * A full-screen camera for scanning a friend's profile code. Everything
 * happens on this device: frames are decoded here -- the browser's own
 * BarcodeDetector where it has one (Chrome, Android), the bundled jsQR
 * elsewhere (Safari, Firefox) -- and nothing is uploaded. A code that is not
 * a Zing profile is ignored rather than opened.
 *
 * No camera, or one that is blocked? Pick a photo of the code instead.
 */
export function QrScanner({
  onUsername,
  onClose,
}: {
  onUsername: (username: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>('Starting the camera…');
  const [wrongCode, setWrongCode] = useState(false);
  const done = useRef(false);

  const onUsernameRef = useRef(onUsername);
  useEffect(() => {
    onUsernameRef.current = onUsername;
  });

  // Each decoded value: a profile ends the scan; anything else is a hint.
  const accept = useCallback((value: string) => {
    if (done.current) return;
    const username = usernameFromScan(value);
    if (username) {
      done.current = true;
      navigator.vibrate?.(30);
      onUsernameRef.current(username);
    } else {
      setWrongCode(true);
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('This browser can’t use the camera here. Choose a photo of the code instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (cause) {
        const name = (cause as { name?: string }).name;
        setStatus(
          name === 'NotAllowedError'
            ? 'Camera access is blocked for Zing. Allow it in your browser’s site settings, or choose a photo.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera found. Choose a photo of the code instead.'
              : 'Could not start the camera. Choose a photo of the code instead.',
        );
        return;
      }
      if (!live || !video.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setStatus('Point the camera at a Zing profile code.');

      const decode = await makeDecoder(canvas);
      const tick = async () => {
        if (!live || done.current) return;
        const frame = video.current;
        if (frame && frame.readyState >= 2) {
          const value = await decode(frame).catch(() => null);
          if (value) accept(value);
        }
        timer = setTimeout(() => void tick(), 180);
      };
      void tick();
    }

    void start();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [accept]);

  async function fromPhoto(picked: File) {
    setWrongCode(false);
    const url = URL.createObjectURL(picked);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const value = await (await makeDecoder(canvas))(image);
      if (value) accept(value);
      else setStatus('No QR code found in that photo. Try a sharper one.');
    } catch {
      setStatus('Could not read that photo.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Scan a QR code"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between px-3 pt-safe">
        <button
          onClick={onClose}
          aria-label="Close scanner"
          className="mt-2 grid size-11 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <p className="mt-2 text-[15px] font-semibold">Scan a profile code</p>
        <span className="size-11" />
      </div>

      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        {/* The viewfinder: a clear square, the rest dimmed. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-[min(70vw,300px)] rounded-3xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
        </div>
      </div>

      <div className="space-y-3 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center">
        <p className="text-[14px] leading-relaxed text-white/85" aria-live="polite">
          {wrongCode ? 'That code isn’t a Zing profile. Try another.' : status}
        </p>
        <button
          onClick={() => file.current?.click()}
          className="h-11 rounded-full bg-white/15 px-5 text-[14px] font-medium transition-colors hover:bg-white/25"
        >
          Choose a photo
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked) void fromPhoto(picked);
          }}
        />
        <p className="text-[12px] text-white/50">Decoded on this device. Nothing is uploaded.</p>
      </div>
    </div>
  );
}

/** Turns an image or video frame into the text in its QR code, if any. */
async function makeDecoder(
  canvas: { current: HTMLCanvasElement | null },
): Promise<(source: HTMLVideoElement | HTMLImageElement) => Promise<string | null>> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code'] });
      return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
    } catch {
      // Present but without QR support: fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr');
  return async (source) => {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return null;
    // Scaled down: a code fills much of the frame, and full camera
    // resolution would make each pass slow on a phone.
    const scale = Math.min(1, 640 / Math.max(width, height));
    const target = (canvas.current ??= document.createElement('canvas'));
    target.width = Math.round(width * scale);
    target.height = Math.round(height * scale);
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, target.width, target.height);
    const pixels = context.getImageData(0, 0, target.width, target.height);
    return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
  };
}
