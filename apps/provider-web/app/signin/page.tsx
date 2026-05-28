'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';

import { Icon } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';
import { signInEmailPassword, signInWithGoogle } from '@/lib/supabase';

const WEB_TOOLS = [
  { icon: 'shield', label: 'Stripe Connect KYC' },
  { icon: 'receipt', label: 'Payouts & 1099-K' },
  { icon: 'edit', label: 'License uploads' },
  { icon: 'briefcase', label: 'Public profile editor' },
] as const;

export default function SigninPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInEmailPassword(email, password);
      window.location.href = '/portal';
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle(window.location.origin + '/portal');
    } catch (err) {
      setError(extractMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={brandPanelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={brandMarkStyle}>oh</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Our Haven</div>
            <div style={brandSublabelStyle}>provider portal</div>
          </div>
        </div>

        <div style={{ maxWidth: 500 }}>
          <span style={welcomeBadgeStyle}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: OH.c.highlight }} />
            Welcome back
          </span>
          <h1 style={brandH1Style}>
            The keyboard side
            <br />
            of your practice.
          </h1>
          <p style={brandLeadStyle}>
            Manage your verification, your weekly availability, your Stripe payouts and the long-running parent
            threads from one place. Day-to-day booking acceptance still lives on your phone — this is for the work
            that needs a real keyboard.
          </p>

          <div style={webToolsStyle}>
            <div style={webToolsHeaderStyle}>Web is the better tool for</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              {WEB_TOOLS.map((it) => (
                <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={webToolIconStyle}>
                    <Icon name={it.icon} size={14} color={OH.c.catSpec} />
                  </span>
                  <span style={{ opacity: 0.92 }}>{it.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={brandFooterStyle}>
          <span>v2026.05.27</span>
          <span>portal.ourhaven.com · US-region · SOC 2 controls active</span>
        </div>
      </div>

      <form onSubmit={submitEmail} style={formColumnStyle}>
        <div>
          <div style={eyebrowStyle}>Sign in</div>
          <h2 style={formTitleStyle}>Welcome back.</h2>
          <div style={{ fontSize: 13, color: OH.c.ink2, marginTop: 8, lineHeight: '19px' }}>
            New here?{' '}
            <Link href="/signup" style={{ color: OH.c.ink, fontWeight: 700, textDecoration: 'underline' }}>
              Apply to caregive →
            </Link>
          </div>
        </div>

        <button type="button" onClick={submitGoogle} disabled={submitting} style={ssoBtnStyle}>
          <Icon name="google" size={18} /> Continue with Google
        </button>

        <div style={dividerStyle}>
          <div style={{ flex: 1, height: 1, background: OH.c.hairline }} />
          <span style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>or with email</span>
          <div style={{ flex: 1, height: 1, background: OH.c.hairline }} />
        </div>

        <div>
          <Label>Email</Label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Label inline>Password</Label>
            <a style={forgotLinkStyle}>Forgot?</a>
          </div>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </div>

        <button type="submit" disabled={submitting} style={primaryCtaStyle}>
          {submitting ? 'Signing in…' : 'Sign in'}
          {!submitting && <Icon name="arrow-right" size={16} color={OH.c.inkInv} />}
        </button>

        {error && <p style={errorStyle}>{error}</p>}

        <div style={mobileHintStyle}>
          <div style={mobileHintIconStyle}>
            <Icon name="message" size={16} color={OH.c.ink2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: OH.c.ink }}>Day-to-day work is on the phone</div>
            <div style={{ fontSize: 11, color: OH.c.ink2, lineHeight: '15px', marginTop: 2 }}>
              Booking requests now arrive as chat in the Our Haven app — Accept and Counter live in the message
              thread. We&apos;ll text you the moment one lands.
            </div>
          </div>
        </div>

        <div style={legalStyle}>
          By continuing you agree to the <u>Provider Terms</u> and <u>Privacy Notice</u>. We use cookies for session
          and security only — no marketing trackers on this portal.
        </div>
      </form>
    </div>
  );
}

function Label({ children, inline = false }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        color: OH.c.ink2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: inline ? 0 : 6,
      }}
    >
      {children}
    </label>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('message' in err) return String((err as { message: unknown }).message);
    if ('error' in err) return String((err as { error: unknown }).error);
  }
  return 'Sign-in failed.';
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: OH.c.ink,
  display: 'flex',
  alignItems: 'stretch',
};

const brandPanelStyle: CSSProperties = {
  flex: 1.1,
  padding: '40px 56px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  color: OH.c.inkInv,
  position: 'relative',
  overflow: 'hidden',
  background: `radial-gradient(circle at 22% 28%, rgba(30,122,134,0.45), transparent 55%), radial-gradient(circle at 82% 78%, rgba(197,230,205,0.22), transparent 55%)`,
  minHeight: '100vh',
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
};

const brandSublabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  opacity: 0.55,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const welcomeBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 12px',
  borderRadius: 999,
  background: 'rgba(251,247,239,0.08)',
  marginBottom: 18,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const brandH1Style: CSSProperties = {
  fontSize: 48,
  lineHeight: '54px',
  fontWeight: 700,
  letterSpacing: -1.6,
  margin: 0,
};

const brandLeadStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: '24px',
  opacity: 0.78,
  marginTop: 18,
};

const webToolsStyle: CSSProperties = {
  marginTop: 28,
  padding: 18,
  borderRadius: 22,
  border: '1px solid rgba(251,247,239,0.12)',
  background: 'rgba(0,0,0,0.18)',
};

const webToolsHeaderStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  opacity: 0.6,
  marginBottom: 10,
};

const webToolIconStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'rgba(197,230,205,0.16)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const brandFooterStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 11,
  opacity: 0.5,
};

const formColumnStyle: CSSProperties = {
  width: 460,
  background: OH.c.canvas,
  padding: '56px 44px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 16,
  flexShrink: 0,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: OH.c.ink2,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 8,
};

const formTitleStyle: CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  color: OH.c.ink,
  letterSpacing: -0.9,
  margin: 0,
  lineHeight: '34px',
};

const ssoBtnStyle: CSSProperties = {
  height: 50,
  borderRadius: 999,
  border: `1.5px solid ${OH.c.hairline}`,
  background: OH.c.surface,
  color: OH.c.ink,
  fontSize: 14,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  marginTop: 4,
};

const dividerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 11,
  color: OH.c.ink3,
  margin: '4px 0',
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 50,
  borderRadius: 14,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  padding: '0 14px',
  fontSize: 14,
  color: OH.c.ink,
  outline: 'none',
};

const forgotLinkStyle: CSSProperties = {
  fontSize: 11,
  color: OH.c.brand,
  fontWeight: 600,
  textDecoration: 'underline',
  cursor: 'pointer',
};

const primaryCtaStyle: CSSProperties = {
  height: 52,
  borderRadius: 999,
  border: 'none',
  background: OH.c.brand,
  color: OH.c.inkInv,
  fontSize: 15,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  marginTop: 4,
};

const mobileHintStyle: CSSProperties = {
  marginTop: 8,
  padding: 14,
  borderRadius: 16,
  background: OH.c.surface,
  border: `1px solid ${OH.c.hairline}`,
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
};

const mobileHintIconStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  background: OH.c.surfaceAlt,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const legalStyle: CSSProperties = {
  fontSize: 10,
  color: OH.c.ink3,
  lineHeight: '14px',
  marginTop: 6,
  textAlign: 'center',
};

const errorStyle: CSSProperties = { color: OH.c.danger, fontSize: 13 };
