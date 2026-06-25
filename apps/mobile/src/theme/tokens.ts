/**
 * Our Haven design tokens — ported from the Claude Design project
 * ("Our Haven mobile.html" → tokens.jsx, itself derived from DESIGN.md).
 *
 * This is the single shared token source for the unified RN/Expo app
 * (web + iOS + Android). Screens reference these — never hard-coded hexes.
 *
 * Brand note (design, refined 2026-05-19): teal `brand` is THE action color
 * (primary CTA fill, active states). Near-black `ink` is reserved for
 * text/headings/icon strokes/outlines only.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  canvas: '#FFF1CE', // app background (warm cream)
  surface: '#FFFFFF',
  surfaceAlt: '#FFF7DD',
  ink: '#161513', // primary text / icon strokes
  ink2: '#5A554C', // secondary text
  ink3: '#9A9489', // tertiary / hints
  inkInv: '#FBF7EF', // text on dark/teal fills
  brand: '#1E7A86', // primary action (teal)
  brandPressed: '#175E68',
  brandSoft: '#E8F2F4',
  // Caregiver category tones (also reused as role-card tones on role-pick)
  catBaby: '#88CEAE', // babysitter — mint
  catTutor: '#F6D88D', // tutor — warm yellow
  catNanny: '#949571', // nanny — olive
  catSpec: '#C5E6CD', // specialist/provider — pale mint
  highlight: '#FFD84D',
  success: '#2F7A4D',
  warning: '#C97A2A',
  danger: '#B23A2F',
  info: '#3A6FA8',
  hairline: '#EAE2D2',
  monoGray: '#D8D2C5',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Font family names. These match the @expo-google-fonts/inter exports loaded
 * in the root layout. Until fonts finish loading the system font shows; that
 * is acceptable for a skeleton.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })!,
} as const;

/** 4-pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radii = {
  sm: 14,
  md: 18,
  lg: 22,
  xl: 24,
  pill: 999,
} as const;

/** Typographic roles — TextStyle fragments to spread onto <Text>. */
export const typography = {
  hero: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 42, letterSpacing: -1 },
  h1: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  h2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodySm: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

/** Elevation tokens — platform-aware (iOS shadow props / Android elevation / web boxShadow). */
export const shadow = {
  e1: Platform.select<ViewStyle>({
    ios: { shadowColor: '#161513', shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    android: { elevation: 1 },
    default: { boxShadow: '0 1px 2px rgba(22,21,19,0.06)' } as ViewStyle,
  })!,
  e2: Platform.select<ViewStyle>({
    ios: { shadowColor: '#161513', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 4 },
    default: { boxShadow: '0 4px 12px rgba(22,21,19,0.08)' } as ViewStyle,
  })!,
  e3: Platform.select<ViewStyle>({
    ios: { shadowColor: '#161513', shadowOpacity: 0.1, shadowRadius: 32, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 10 },
    default: { boxShadow: '0 12px 32px rgba(22,21,19,0.10)' } as ViewStyle,
  })!,
} as const;

/** Max content width on web so screens stay phone-shaped on large viewports. */
export const maxContentWidth = 480;
