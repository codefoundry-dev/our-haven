import type { SVGProps } from 'react';

export type IconName =
  | 'arrow-right'
  | 'arrow-left'
  | 'check'
  | 'check-circle'
  | 'lock'
  | 'message'
  | 'google'
  | 'shield'
  | 'receipt'
  | 'edit'
  | 'briefcase'
  | 'plus'
  | 'info'
  | 'clock'
  | 'dots'
  | 'bell'
  | 'upload';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'color'> {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.5, ...rest }: IconProps) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
  switch (name) {
    case 'arrow-right':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...p}>
          <path d="M19 12H5M11 5l-7 7 7 7" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M5 12l4.5 4.5L19 7" />
        </svg>
      );
    case 'check-circle':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'message':
      return (
        <svg {...p}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...p}>
          <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...p}>
          <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...p}>
          <path d="M4 20h4l11-11-4-4L4 16v4z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg {...p}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v.5" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'dots':
      return (
        <svg {...p}>
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...p}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...p}>
          <path d="M12 4v12M7 9l5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'google':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
          <path
            fill="#4285F4"
            d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.2-.9 2.3-2 3v2.4h3.2c1.9-1.7 3-4.3 3-7.2z"
          />
          <path
            fill="#34A853"
            d="M12 21.6c2.7 0 5-.9 6.6-2.4l-3.2-2.4c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.5C4.8 19.4 8.1 21.6 12 21.6z"
          />
          <path
            fill="#FBBC05"
            d="M6.4 13.7C6.2 13.1 6.1 12.5 6.1 12s.1-1.1.3-1.7V7.8H3.1C2.4 9.1 2 10.5 2 12s.4 2.9 1.1 4.2l3.3-2.5z"
          />
          <path
            fill="#EA4335"
            d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3 14.7 2 12 2 8.1 2 4.8 4.2 3.1 7.5L6.4 10c.8-2.4 3-4.1 5.6-4.1z"
          />
        </svg>
      );
  }
}
