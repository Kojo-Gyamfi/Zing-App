/**
 * The shell for the sign-in screens (login, onboarding, unlock).
 *
 * On a phone it is the whole screen. From md up the same screen sits in a
 * phone-sized panel in the middle of the window, rather than stretching a
 * layout designed for one hand across a monitor.
 */
export function AuthFrame({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh bg-void md:items-center md:justify-center md:p-8">
      <main
        className={`mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe
          md:h-[min(820px,calc(100dvh-4rem))] md:min-h-0 md:overflow-y-auto md:rounded-[32px]
          md:border md:border-line md:bg-surface md:px-8 md:shadow-2xl md:shadow-black/40
          scroll-thin ${className}`}
      >
        {children}
      </main>
    </div>
  );
}
