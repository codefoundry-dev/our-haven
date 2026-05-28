'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { Icon, type IconName } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';

export type PortalNavId =
  | 'home'
  | 'bookings'
  | 'availability'
  | 'messages'
  | 'earnings'
  | 'verification'
  | 'profile';

const NAV_ITEMS: { id: PortalNavId; icon: IconName; label: string; href: string }[] = [
  { id: 'home', icon: 'briefcase', label: 'Dashboard', href: '/portal' },
  { id: 'bookings', icon: 'clock', label: 'Bookings', href: '/portal/bookings' },
  { id: 'availability', icon: 'clock', label: 'Availability', href: '/portal/availability' },
  { id: 'messages', icon: 'message', label: 'Messages', href: '/portal/messages' },
  { id: 'earnings', icon: 'receipt', label: 'Earnings', href: '/portal/earnings' },
  { id: 'verification', icon: 'shield', label: 'Verification', href: '/portal/verification' },
  { id: 'profile', icon: 'edit', label: 'Profile', href: '/portal/profile' },
];

interface SideRailProps {
  active: PortalNavId;
}

export function SideRail({ active }: SideRailProps) {
  return (
    <div style={railStyle}>
      <div style={brandMarkStyle}>oh</div>
      {NAV_ITEMS.map((it) => {
        const isActive = it.id === active;
        return (
          <Link
            key={it.id}
            href={it.href}
            title={it.label}
            aria-current={isActive ? 'page' : undefined}
            style={{
              ...railBtnStyle,
              background: isActive ? OH.c.catSpec : 'transparent',
              color: isActive ? OH.c.ink : 'rgba(251,247,239,0.7)',
            }}
          >
            <Icon name={it.icon} size={20} color={isActive ? OH.c.ink : 'rgba(251,247,239,0.7)'} />
          </Link>
        );
      })}
    </div>
  );
}

interface WebAppBarProps {
  eyebrow: string;
  title: string;
  primary?: { label: string; onClick?: () => void; disabled?: boolean; busy?: boolean };
  secondary?: ReactNode;
}

export function WebAppBar({ eyebrow, title, primary, secondary }: WebAppBarProps) {
  return (
    <div style={appBarStyle}>
      <div>
        <div style={appBarEyebrowStyle}>{eyebrow}</div>
        <h1 style={appBarTitleStyle}>{title}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {secondary}
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.disabled || primary.busy}
            style={{
              ...primaryBtnStyle,
              opacity: primary.disabled || primary.busy ? 0.6 : 1,
              cursor: primary.disabled || primary.busy ? 'not-allowed' : 'pointer',
            }}
          >
            {primary.busy ? 'Saving…' : primary.label}
            {!primary.busy && <Icon name="check" size={16} color={OH.c.inkInv} />}
          </button>
        )}
      </div>
    </div>
  );
}

interface PageFrameProps {
  active: PortalNavId;
  children: ReactNode;
}

export function PageFrame({ active, children }: PageFrameProps) {
  return (
    <div style={frameOuterStyle}>
      <SideRail active={active} />
      <div style={frameMainStyle}>{children}</div>
    </div>
  );
}

const railStyle: CSSProperties = {
  width: 76,
  background: OH.c.ink,
  color: OH.c.inkInv,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '20px 0',
  gap: 8,
  flexShrink: 0,
  minHeight: '100vh',
  position: 'sticky',
  top: 0,
};

const brandMarkStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  background: OH.c.catSpec,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 18,
  color: OH.c.ink,
  marginBottom: 16,
};

const railBtnStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
};

const appBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '32px 36px 24px',
  gap: 24,
};

const appBarEyebrowStyle: CSSProperties = {
  fontSize: 13,
  color: OH.c.ink2,
  fontWeight: 500,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const appBarTitleStyle: CSSProperties = {
  fontSize: 42,
  lineHeight: '48px',
  fontWeight: 700,
  letterSpacing: -1.4,
  color: OH.c.ink,
  margin: 0,
};

const primaryBtnStyle: CSSProperties = {
  height: 44,
  padding: '0 18px',
  borderRadius: 999,
  border: 'none',
  background: OH.c.ink,
  color: OH.c.inkInv,
  fontSize: 14,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const frameOuterStyle: CSSProperties = {
  width: '100%',
  minHeight: '100vh',
  background: OH.c.canvas,
  display: 'flex',
};

const frameMainStyle: CSSProperties = {
  flex: 1,
  position: 'relative',
};
