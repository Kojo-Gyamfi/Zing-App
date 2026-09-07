export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-zing"
          style={{ animationDelay: `${index * 120}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}
