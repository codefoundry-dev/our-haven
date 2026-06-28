/** Post a Job (Parent — native + narrow web). Body lives in `@/screens/parent/PostJob`
 * so the `.web.tsx` desktop dispatcher can render the same native UI at phone width
 * without a circular import. */
export { default } from '@/screens/parent/PostJob';
