/**
 * ParentMessagingWeb — the Parent inbox on desktop web (OH-205). Content-only:
 * the dispatcher wraps this in <ParentWebShell active="messages">.
 *
 * The two-pane list+thread surface is shared with the supply inbox — see
 * `MessagingTwoPaneWeb` (wired to `GET /v1/threads` + Supabase Realtime, with the
 * redaction + Trust & Safety disclosure and no encryption claim).
 */
import { MessagingTwoPaneWeb } from '@/screens/web/shared/MessagingTwoPane';

export function ParentMessagingWeb() {
  return <MessagingTwoPaneWeb role="parent" />;
}
