/**
 * Messages tab (WEB) — role-aware two-pane messaging. Parents get the
 * ParentWebShell chrome; caregiver/clinical Provider get the WebShell chrome.
 *  - WIDE   → the desktop two-pane inbox inside the side-rail chrome.
 *  - NARROW → the native mobile shared Inbox + BottomNav (mirrors messages.tsx),
 *    so phone-width web matches the native design.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { InboxWeb } from '@/screens/web/cp/Inbox';
import { ParentMessagingWeb } from '@/screens/web/parent/Messaging';
import { Inbox } from '@/screens/shared/Inbox';

export default function MessagesWeb() {
  const { role } = useAuth();
  const wide = useWebWide();

  // Phone-width web → native mobile UI/flow (same as messages.tsx).
  if (!wide) return <Inbox role={role ?? 'parent'} />;

  if (role === 'caregiver' || role === 'provider') {
    return (
      <WebShell role={role} active="messages">
        <InboxWeb role={role} />
      </WebShell>
    );
  }
  return (
    <ParentWebShell active="messages">
      <ParentMessagingWeb />
    </ParentWebShell>
  );
}
