/**
 * Avatar with a deterministic fallback: the same person always gets the same
 * colour, so the chat list stays visually stable between sessions.
 */
export function Avatar({
  name,
  photoURL,
  size = 48,
  online,
}: {
  name: string;
  photoURL?: string | null;
  size?: number;
  online?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  const hue = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {photoURL ? (
        // Remote Google avatars: plain img avoids configuring next/image hosts
        // for something already this small.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL}
          alt=""
          className="size-full rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center rounded-full font-semibold text-white/90"
          style={{
            background: `linear-gradient(140deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 55% 30%))`,
            fontSize: size * 0.36,
          }}
        >
          {initials}
        </div>
      )}

      {online && (
        <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-void bg-zing" />
      )}
    </div>
  );
}
