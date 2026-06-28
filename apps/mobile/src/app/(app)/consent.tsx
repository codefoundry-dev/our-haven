/** Sensitive-information consent (native + narrow web). Body lives in
 * `@/screens/parent/Consent` so the `.web.tsx` desktop dispatcher can render the
 * same native UI at phone width without a circular import. */
export { default } from '@/screens/parent/Consent';
