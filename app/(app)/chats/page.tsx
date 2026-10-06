/** Desktop resting state. On mobile this pane is hidden and the list fills the screen. */
export default function NoChatSelected() {
  return (
    <div className="hidden h-full flex-col items-center justify-center gap-3 px-8 text-center md:flex">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/zing-mark.png" alt="" className="size-28 opacity-30" />
      <p className="text-[15px] text-muted">Pick a conversation to start reading.</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-faint">
        Messages are decrypted here on your device. They exist as unreadable ciphertext everywhere
        else, including on our servers.
      </p>
    </div>
  );
}
