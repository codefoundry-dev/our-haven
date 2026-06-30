/**
 * InboxWeb — two-pane messaging for Caregiver + clinical Provider on desktop web
 * (OH-205). Content-only — the route dispatcher wraps this in <WebShell>.
 *
 * The list+thread surface is shared with the Parent inbox — see
 * `MessagingTwoPaneWeb` (wired to `GET /v1/threads` + Supabase Realtime, with the
 * redaction + Trust & Safety disclosure and no encryption claim). v1 only
 * materialises Parent↔Caregiver threads, so a Provider's inbox is empty.
 */
import { MessagingTwoPaneWeb } from '@/screens/web/shared/MessagingTwoPane';

export function InboxWeb({ role }: { role: 'caregiver' | 'provider' }) {
  return <MessagingTwoPaneWeb role={role} />;
}
