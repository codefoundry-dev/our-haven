/**
 * Messages tab — shared Inbox for all three roles (the conversation list is the
 * same surface; copy adapts to the signed-in role).
 */
import { useAuth } from '@/auth/AuthProvider';
import { Inbox } from '@/screens/shared/Inbox';

export default function MessagesRoute() {
  const { role } = useAuth();
  return <Inbox role={role ?? 'parent'} />;
}
