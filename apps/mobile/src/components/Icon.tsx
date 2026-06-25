/**
 * Icon — ported from the Claude Design icon set (tokens.jsx).
 * Phosphor-ish, 1.5px stroke, 24x24 viewBox. Cross-platform via react-native-svg.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export type IconName =
  | 'arrow-up-right'
  | 'arrow-right'
  | 'arrow-left'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'search'
  | 'bell'
  | 'message'
  | 'calendar'
  | 'house'
  | 'person'
  | 'bookmark'
  | 'star'
  | 'check'
  | 'check-circle'
  | 'plus'
  | 'video'
  | 'receipt'
  | 'send'
  | 'shield'
  | 'pin'
  | 'briefcase'
  | 'lock'
  | 'x'
  | 'edit'
  | 'info'
  | 'clock'
  | 'dollar'
  | 'sparkle'
  | 'eye';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color = colors.ink, strokeWidth = 1.5 }: IconProps) {
  // Shared stroke props for outline-style glyphs.
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  const base = { width: size, height: size, viewBox: '0 0 24 24' };

  switch (name) {
    case 'arrow-up-right':
      return <Svg {...base}><Path {...s} d="M7 17 17 7M8 7h9v9" /></Svg>;
    case 'arrow-right':
      return <Svg {...base}><Path {...s} d="M5 12h14M13 5l7 7-7 7" /></Svg>;
    case 'arrow-left':
      return <Svg {...base}><Path {...s} d="M19 12H5M11 5l-7 7 7 7" /></Svg>;
    case 'chevron-left':
      return <Svg {...base}><Path {...s} d="M15 6l-6 6 6 6" /></Svg>;
    case 'chevron-right':
      return <Svg {...base}><Path {...s} d="M9 6l6 6-6 6" /></Svg>;
    case 'chevron-down':
      return <Svg {...base}><Path {...s} d="M6 9l6 6 6-6" /></Svg>;
    case 'search':
      return <Svg {...base}><Circle {...s} cx="11" cy="11" r="7" /><Path {...s} d="M20 20l-3.5-3.5" /></Svg>;
    case 'bell':
      return <Svg {...base}><Path {...s} d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0" /></Svg>;
    case 'message':
      return <Svg {...base}><Path {...s} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></Svg>;
    case 'calendar':
      return <Svg {...base}><Rect {...s} x="3" y="5" width="18" height="16" rx="2" /><Path {...s} d="M16 3v4M8 3v4M3 10h18" /></Svg>;
    case 'house':
      return <Svg {...base}><Path {...s} d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9z" /></Svg>;
    case 'person':
      return <Svg {...base}><Circle {...s} cx="12" cy="8" r="4" /><Path {...s} d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></Svg>;
    case 'bookmark':
      return <Svg {...base}><Path {...s} d="M6 4h12v17l-6-4-6 4V4z" /></Svg>;
    case 'star':
      return <Svg {...base}><Path fill={color} d="M12 2.5l2.9 6.5 7.1.8-5.3 4.8 1.5 7-6.2-3.7-6.2 3.7 1.5-7L2 9.8l7.1-.8L12 2.5z" /></Svg>;
    case 'check':
      return <Svg {...base}><Path {...s} d="M5 12l4.5 4.5L19 7" /></Svg>;
    case 'check-circle':
      return <Svg {...base}><Circle {...s} cx="12" cy="12" r="9" /><Path {...s} d="M8 12.5l3 3 5-6" /></Svg>;
    case 'plus':
      return <Svg {...base}><Path {...s} d="M12 5v14M5 12h14" /></Svg>;
    case 'video':
      return <Svg {...base}><Rect {...s} x="3" y="6" width="13" height="12" rx="2" /><Path {...s} d="M16 10l5-3v10l-5-3" /></Svg>;
    case 'receipt':
      return <Svg {...base}><Path {...s} d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z" /><Path {...s} d="M9 8h6M9 12h6M9 16h4" /></Svg>;
    case 'send':
      return <Svg {...base}><Path {...s} d="M21 3L3 11l7 3 3 7 8-18zM10 14l4-4" /></Svg>;
    case 'shield':
      return <Svg {...base}><Path {...s} d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5V6l8-3z" /><Path {...s} d="M9 12l2 2 4-4" /></Svg>;
    case 'pin':
      return <Svg {...base}><Path {...s} d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" /><Circle {...s} cx="12" cy="9" r="2.5" /></Svg>;
    case 'briefcase':
      return <Svg {...base}><Rect {...s} x="3" y="7" width="18" height="13" rx="2" /><Path {...s} d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></Svg>;
    case 'lock':
      return <Svg {...base}><Rect {...s} x="5" y="11" width="14" height="10" rx="2" /><Path {...s} d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
    case 'x':
      return <Svg {...base}><Path {...s} d="M6 6l12 12M18 6L6 18" /></Svg>;
    case 'edit':
      return <Svg {...base}><Path {...s} d="M4 20h4l11-11-4-4L4 16v4z" /><Path {...s} d="M14 6l4 4" /></Svg>;
    case 'info':
      return <Svg {...base}><Circle {...s} cx="12" cy="12" r="9" /><Path {...s} d="M12 11v6M12 7.5v.5" /></Svg>;
    case 'clock':
      return <Svg {...base}><Circle {...s} cx="12" cy="12" r="9" /><Path {...s} d="M12 7v5l3 2" /></Svg>;
    case 'dollar':
      return <Svg {...base}><Path {...s} d="M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" /></Svg>;
    case 'sparkle':
      return <Svg {...base}><Path {...s} d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" /></Svg>;
    case 'eye':
      return <Svg {...base}><Circle {...s} cx="12" cy="12" r="3" /><Path {...s} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /></Svg>;
    default:
      return <Svg {...base}><Circle {...s} cx="12" cy="12" r="6" /></Svg>;
  }
}
