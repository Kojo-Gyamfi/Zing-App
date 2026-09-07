export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="size-16 rounded-2xl opacity-60" />
      <h1 className="text-lg font-semibold">No connection</h1>
      <p className="max-w-xs text-[14px] leading-relaxed text-muted">
        Chats you have already opened are still readable. Anything you send now will go out as soon
        as you are back online.
      </p>
    </main>
  );
}
