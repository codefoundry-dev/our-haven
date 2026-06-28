/**
 * Message thread (WEB) — one open 1:1 conversation, shared by Parent + supply roles.
 *  - WIDE   → the bespoke desktop thread column inside the role-aware side-rail chrome
 *    (ParentWebShell for parents, WebShell for caregiver/clinical Provider).
 *  - NARROW → the native mobile MessageThread (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over message-thread.tsx on web; the native file is untouched.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { MessageThreadWeb } from '@/screens/web/shared/MessageThread';
import MessageThreadScreen from '@/screens/shared/MessageThread';

export default function MessageThreadWebRoute() {
  const { role } = useAuth();

  // Phone-width web → native mobile UI (same as the native message-thread route).
  if (!useWebWide()) return <MessageThreadScreen />;

  if (role === 'caregiver' || role === 'provider') {
    return (
      <WebShell role={role} active="messages">
        <MessageThreadWeb />
      </WebShell>
    );
  }
  return (
    <ParentWebShell active="messages">
      <MessageThreadWeb />
    </ParentWebShell>
  );
}
