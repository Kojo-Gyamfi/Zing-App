import { Spinner } from './ui/Spinner';

export function Splash({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-void">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/zing-logo-dark.png" alt="Zing" className="w-44 glow-zing animate-pulse" />
      <div className="flex items-center gap-2 text-muted">
        <Spinner />
        <span className="text-sm">{label ?? 'Loading'}</span>
      </div>
    </div>
  );
}
