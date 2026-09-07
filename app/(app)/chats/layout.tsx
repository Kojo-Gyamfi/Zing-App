'use client';

import { usePathname } from 'next/navigation';
import { ChatListPanel } from '@/components/chat/ChatListPanel';

/**
 * Mobile-first: one pane at a time, the list swapping out for the thread.
 * From md up both sit side by side, WhatsApp Web style.
 *
 * The list lives in the layout rather than the page so that navigating into a
 * conversation does not tear down its Firestore subscription and pay to
 * rebuild it on the way back.
 */
export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  const inThread = usePathname() !== '/chats';

  return (
    <div className="flex h-dvh overflow-hidden bg-void">
      <aside
        className={`w-full flex-col border-line md:flex md:w-[380px] md:border-r
          ${inThread ? 'hidden' : 'flex'}`}
      >
        <ChatListPanel />
      </aside>

      <main className={`min-w-0 flex-1 flex-col ${inThread ? 'flex' : 'hidden md:flex'}`}>
        {children}
      </main>
    </div>
  );
}
