export function TypingDots({ className = 'size-1.5 bg-zing' }: { className?: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`animate-bounce rounded-full ${className}`}
          style={{ animationDelay: `${index * 120}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

/**
 * WhatsApp's "someone is typing" bubble, at the bottom of the thread where
 * their message is about to appear.
 */
export function TypingBubble() {
  return (
    <div className="flex justify-start pt-1" role="status" aria-label="typing">
      <div className="flex h-9 items-center rounded-2xl rounded-bl-md bg-bubble-in px-4">
        <TypingDots className="size-2 bg-muted" />
      </div>
    </div>
  );
}
