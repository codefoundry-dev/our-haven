/** 1:1 message thread (native + narrow web). Body lives in `@/screens/shared/MessageThread`
 * so the `.web.tsx` desktop dispatcher can render the same native UI at phone width without a
 * circular import. */
export { default } from '@/screens/shared/MessageThread';
