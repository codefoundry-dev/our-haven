/**
 * Our Haven design tokens — ported from the Claude design bundle
 * (`Our Haven web.html` → `tokens.jsx`). Used by the provider-web app to keep
 * sign-in / sign-up / portal screens in lock-step with the design system.
 *
 * Colour roles:
 *   - `brand` is THE action colour (primary CTA fill, focus rings, sent
 *     message bubbles). Near-black `ink` is reserved for text/headings/strokes.
 *   - Category tints map to Provider kinds (babysitter / tutor / nanny / specialist).
 */
export const OH = {
  font: "'Inter', system-ui, sans-serif",
  c: {
    canvas: '#FFF1CE',
    surface: '#FFFFFF',
    surfaceAlt: '#FFF7DD',
    ink: '#161513',
    ink2: '#5A554C',
    ink3: '#9A9489',
    inkInv: '#FBF7EF',
    brand: '#1E7A86',
    brandPressed: '#175E68',
    brandSoft: '#E8F2F4',
    catBaby: '#88CEAE',
    catTutor: '#F6D88D',
    catNanny: '#949571',
    catSpec: '#C5E6CD',
    highlight: '#FFD84D',
    success: '#2F7A4D',
    warning: '#C97A2A',
    danger: '#B23A2F',
    info: '#3A6FA8',
    hairline: '#EAE2D2',
    monoGray: '#D8D2C5',
  },
  shadow: {
    e1: '0 1px 2px rgba(22,21,19,0.04), 0 1px 1px rgba(22,21,19,0.04)',
    e2: '0 4px 12px rgba(22,21,19,0.06), 0 2px 4px rgba(22,21,19,0.04)',
    e3: '0 12px 32px rgba(22,21,19,0.10), 0 4px 8px rgba(22,21,19,0.06)',
  },
} as const;
