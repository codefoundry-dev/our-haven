/**
 * Account tab (native + narrow web). The screen body lives in
 * `@/screens/shared/Account` so the `.web.tsx` desktop dispatcher can render the
 * exact same native UI at phone width (a `.web.tsx` route can't import its own
 * native sibling — Metro resolves it back to the web file).
 */
export { default } from '@/screens/shared/Account';
