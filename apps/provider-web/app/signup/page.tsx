'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';

import {
  US_STATES_50_PLUS_DC,
  type CaregiverCategory,
  type Specialty,
  type UsState,
} from '@our-haven/shared';

import { Icon } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';
import { postProviderSignup, type ProviderSignupRequest } from '@/lib/api';
import { signUpWithEmailPassword } from '@/lib/supabase';

type RoleTab = 'parent' | 'caregiver' | 'specialist';

const ROLE_TABS: { id: RoleTab; label: string; helper: string }[] = [
  { id: 'parent', label: 'Parent', helper: 'Find a sitter' },
  { id: 'caregiver', label: 'Caregiver', helper: 'Babysitter · Tutor · Nanny' },
  { id: 'specialist', label: 'Specialist', helper: 'SLP · OT · ABA · Therapy' },
];

const CAREGIVER_OPTIONS: { id: CaregiverCategory; label: string; blurb: string; tint: string }[] = [
  { id: 'babysitter', label: 'Babysitter', blurb: 'Evenings + weekends · $18–28/hr', tint: OH.c.catBaby },
  { id: 'tutor', label: 'Tutor', blurb: 'In-home or online · $30–60/hr', tint: OH.c.catTutor },
  { id: 'nanny', label: 'Nanny', blurb: 'Recurring blocks · $22–35/hr', tint: OH.c.catNanny },
];

const SPECIALTY_OPTIONS: { id: Specialty; label: string; blurb: string }[] = [
  { id: 'slp', label: 'Speech-Language Pathology', blurb: 'SLP · per-session rate' },
  { id: 'ot', label: 'Occupational Therapy', blurb: 'OT · per-session rate' },
  { id: 'aba', label: 'Applied Behavior Analysis', blurb: 'ABA · per-session rate' },
  { id: 'psychology', label: 'Psychology', blurb: 'Clinical / counselling' },
  { id: 'other', label: 'Other clinical', blurb: 'Reviewed against your state board' },
];

const STEPS = [
  {
    n: '01',
    t: 'Tell us about yourself',
    d: 'Pick the role that fits, your state, and your contact info. 3 minutes on a desktop or laptop — phones work but documents are easier on a bigger screen.',
  },
  {
    n: '02',
    t: 'Verify your identity',
    d: 'Stripe Identity matches your face to a state-issued ID. Then a national background check through Checkr — $49 charged once.',
  },
  {
    n: '03',
    t: 'Get booked',
    d: 'When your check clears we publish you. Parents in your area can message you, book you, and pay through Stripe. We skim 18%; you keep the rest.',
  },
];

const TRUST_STATS = [
  { n: '4.8★', l: 'Caregiver satisfaction · early cohort' },
  { n: '18%', l: 'Flat platform fee · no hidden cuts' },
  { n: '48h', l: 'Average payout · Stripe Connect direct' },
  { n: '0%', l: 'Apple/Google tax — paid on the web' },
];

export default function SignupPage() {
  const [tab, setTab] = useState<RoleTab>('caregiver');
  const [caregiverCategory, setCaregiverCategory] = useState<CaregiverCategory>('babysitter');
  const [specialty, setSpecialty] = useState<Specialty>('slp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<UsState>('NY');
  const [consent, setConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tab === 'parent') return;
    setError(null);
    setSuccess(null);
    if (!consent) {
      setError('Please authorise the background check to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: ProviderSignupRequest =
        tab === 'caregiver'
          ? { role: 'caregiver', categories: [caregiverCategory], state }
          : { role: 'provider', specialty, state };
      const { session } = await signUpWithEmailPassword(email, password);
      const created = await postProviderSignup(session.access_token, payload);
      setSuccess(
        created.role === 'caregiver'
          ? `Account created — ${created.categories?.join(', ')} in ${created.state}.`
          : `Account created — ${created.specialty} in ${created.state}.`,
      );
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <Header />

      <div style={layoutStyle}>
        <section>
          <span style={badgeStyle}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: OH.c.brand }} />
            Now onboarding caregivers across the US · early access
          </span>

          <h1 style={heroTitleStyle}>
            Get hired by families who pay on time, on a platform that does the safety work for you.
          </h1>
          <p style={heroSubtitleStyle}>
            Babysitter, tutor, nanny, or clinical specialist — set up your profile, clear a national background check,
            and start receiving booking requests from vetted families.
          </p>

          <div style={{ marginTop: 36 }}>
            <div style={eyebrowStyle}>How it works</div>
            {STEPS.map((s) => (
              <div key={s.n} style={stepRowStyle}>
                <div style={stepNumStyle}>{s.n}</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: OH.c.ink }}>{s.t}</div>
                  <div style={{ fontSize: 14, color: OH.c.ink2, marginTop: 4, lineHeight: '21px', maxWidth: 560 }}>
                    {s.d}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={trustStripStyle}>
            {TRUST_STATS.map((s) => (
              <div key={s.l} style={{ flex: '1 1 180px' }}>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: -0.8,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.n}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2, lineHeight: '17px' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        <aside style={{ position: 'sticky', top: 24, height: 'fit-content' }}>
          <div style={formCardStyle}>
            <div style={eyebrowStyle}>I&apos;m signing up as a…</div>
            <div role="tablist" aria-label="Role" style={tabBarStyle}>
              {ROLE_TABS.map((t) => {
                const sel = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={sel}
                    onClick={() => setTab(t.id)}
                    style={{
                      ...tabBtnStyle,
                      background: sel ? OH.c.ink : OH.c.surface,
                      color: sel ? OH.c.inkInv : OH.c.ink,
                      borderColor: sel ? OH.c.ink : OH.c.hairline,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{t.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        marginTop: 2,
                        opacity: sel ? 0.78 : 0.6,
                      }}
                    >
                      {t.helper}
                    </span>
                  </button>
                );
              })}
            </div>

            {tab === 'parent' && <ParentPanel />}

            {tab === 'caregiver' && (
              <ProviderForm
                kindLabel="Apply to caregive"
                step="step 1 of 3"
                subSelectorLabel="What kind of caregiver?"
                subSelector={
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {CAREGIVER_OPTIONS.map((o) => {
                      const sel = o.id === caregiverCategory;
                      return (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() => setCaregiverCategory(o.id)}
                          aria-pressed={sel}
                          style={{
                            ...subCardStyle,
                            background: sel ? o.tint : OH.c.surfaceAlt,
                            borderColor: sel ? OH.c.ink : 'transparent',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700, color: OH.c.ink }}>{o.label}</span>
                          <span
                            style={{ fontSize: 10, fontWeight: 500, color: OH.c.ink2, marginTop: 4, lineHeight: '14px' }}
                          >
                            {o.blurb}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                }
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                state={state}
                setState={setState}
                consent={consent}
                setConsent={setConsent}
                submit={submit}
                submitting={submitting}
                error={error}
                success={success}
              />
            )}

            {tab === 'specialist' && (
              <ProviderForm
                kindLabel="Apply as a specialist"
                step="step 1 of 3"
                subSelectorLabel="What's your specialty?"
                subSelector={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {SPECIALTY_OPTIONS.map((o) => {
                      const sel = o.id === specialty;
                      return (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() => setSpecialty(o.id)}
                          aria-pressed={sel}
                          style={{
                            ...specialtyRowStyle,
                            background: sel ? OH.c.catSpec : OH.c.surfaceAlt,
                            borderColor: sel ? OH.c.ink : 'transparent',
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              border: `1.5px solid ${OH.c.ink}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {sel && (
                              <span style={{ width: 8, height: 8, borderRadius: 999, background: OH.c.ink }} />
                            )}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: OH.c.ink }}>
                              {o.label}
                            </span>
                            <span style={{ display: 'block', fontSize: 11, color: OH.c.ink2, marginTop: 1 }}>
                              {o.blurb}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                }
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                state={state}
                setState={setState}
                consent={consent}
                setConsent={setConsent}
                submit={submit}
                submitting={submitting}
                error={error}
                success={success}
              />
            )}
          </div>

          <div style={footerHintStyle}>
            <Icon name="lock" size={12} color={OH.c.ink3} />
            Encrypted submission · we never sell your data
          </div>
        </aside>
      </div>
    </div>
  );
}

interface ProviderFormProps {
  kindLabel: string;
  step: string;
  subSelectorLabel: string;
  subSelector: React.ReactNode;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  state: UsState;
  setState: (v: UsState) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  submit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
  success: string | null;
}

function ProviderForm(props: ProviderFormProps) {
  return (
    <form onSubmit={props.submit} style={{ marginTop: 4 }}>
      <div style={{ ...eyebrowStyle, marginBottom: 6 }}>
        {props.kindLabel} · {props.step}
      </div>
      <h2 style={formTitleStyle}>Start your application</h2>

      <div style={fieldBlockStyle}>
        <Label>{props.subSelectorLabel}</Label>
        {props.subSelector}
      </div>

      <div style={fieldBlockStyle}>
        <Label>Email</Label>
        <Field
          type="email"
          autoComplete="email"
          required
          value={props.email}
          onChange={(e) => props.setEmail(e.target.value)}
        />
      </div>

      <div style={fieldBlockStyle}>
        <Label>Password</Label>
        <Field
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={props.password}
          onChange={(e) => props.setPassword(e.target.value)}
        />
      </div>

      <div style={fieldBlockStyle}>
        <Label>Resident state</Label>
        <SelectField value={props.state} onChange={(e) => props.setState(e.target.value as UsState)}>
          {US_STATES_50_PLUS_DC.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </div>

      <p style={permanenceNoteStyle}>
        <Icon name="info" size={12} color={OH.c.ink2} />
        Role, category, and resident state are permanent once we create your account. To work in a second role, sign up
        with a separate email.
      </p>

      <label style={consentRowStyle}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: props.consent ? OH.c.ink : OH.c.surface,
            border: props.consent ? 'none' : `1.5px solid ${OH.c.ink2}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {props.consent && <Icon name="check" size={12} color={OH.c.inkInv} />}
        </span>
        <input
          type="checkbox"
          checked={props.consent}
          onChange={(e) => props.setConsent(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          aria-label="Authorise background check"
        />
        <span style={{ fontSize: 11, color: OH.c.ink2, lineHeight: '16px' }}>
          I authorise Our Haven and its vendor (Checkr, Inc.) to perform a national background check. The $49 fee is
          charged after step 2 and refunded if Our Haven declines my application.
        </span>
      </label>

      <button type="submit" disabled={props.submitting} style={ctaPrimaryStyle}>
        {props.submitting ? 'Creating account…' : 'Continue to step 2'}
        {!props.submitting && <Icon name="arrow-right" size={16} color={OH.c.inkInv} />}
      </button>

      {props.error && <p style={errorStyle}>{props.error}</p>}
      {props.success && <p style={successStyle}>{props.success}</p>}

      <div
        style={{
          marginTop: 14,
          textAlign: 'center',
          fontSize: 11,
          color: OH.c.ink3,
        }}
      >
        Already have an account?{' '}
        <Link href="/signin" style={{ color: OH.c.ink, fontWeight: 700, textDecoration: 'underline' }}>
          Sign in
        </Link>
      </div>
    </form>
  );
}

function ParentPanel() {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...eyebrowStyle, marginBottom: 6 }}>Parents · mobile-first</div>
      <h2 style={formTitleStyle}>Our Haven for parents lives in the app.</h2>
      <p style={{ fontSize: 14, color: OH.c.ink2, lineHeight: '21px', margin: '0 0 18px' }}>
        Finding, messaging, and booking caregivers all happens on your phone — that&apos;s where the trust signals,
        background-check badges, and same-day scheduling actually work. The web portal is the caregiver workbench.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <a
          href="https://apps.apple.com/app/our-haven"
          target="_blank"
          rel="noreferrer"
          style={{ ...storeBtnStyle, background: OH.c.ink, color: OH.c.inkInv, borderColor: OH.c.ink }}
        >
          <span style={{ fontSize: 9, opacity: 0.65, lineHeight: '11px' }}>Download on the</span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>App Store</span>
        </a>
        <a
          href="https://play.google.com/store/apps/details?id=app.ourhaven"
          target="_blank"
          rel="noreferrer"
          style={{ ...storeBtnStyle, background: OH.c.ink, color: OH.c.inkInv, borderColor: OH.c.ink }}
        >
          <span style={{ fontSize: 9, opacity: 0.65, lineHeight: '11px' }}>Get it on</span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>Google Play</span>
        </a>
      </div>

      <div style={parentBulletsStyle}>
        {[
          { i: 'shield' as const, t: 'Every caregiver background-checked', d: 'Stripe Identity + Checkr — no exceptions.' },
          { i: 'message' as const, t: 'Booking is a chat', d: 'Accept / Counter happens inside the thread, not a calendar UI.' },
          { i: 'check-circle' as const, t: 'In-app payment', d: 'Stripe Connect handles funds — no Venmo, no cash, no chasing receipts.' },
        ].map((b) => (
          <div key={b.t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={parentBulletIconStyle}>
              <Icon name={b.i} size={14} color={OH.c.brand} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: OH.c.ink }}>{b.t}</div>
              <div style={{ fontSize: 12, color: OH.c.ink2, marginTop: 2, lineHeight: '17px' }}>{b.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 12,
          background: OH.c.surfaceAlt,
          borderRadius: 12,
          fontSize: 11,
          color: OH.c.ink2,
          lineHeight: '16px',
        }}
      >
        Looking to caregive instead? Pick <strong style={{ color: OH.c.ink }}>Caregiver</strong> or{' '}
        <strong style={{ color: OH.c.ink }}>Specialist</strong> above. Account role is permanent, so use a separate email
        if you want both.
      </div>
    </div>
  );
}

function Header() {
  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={logoMarkStyle}>oh</div>
        <span style={{ fontSize: 15, fontWeight: 700, color: OH.c.ink }}>Our Haven</span>
      </div>
      <nav style={{ display: 'flex', gap: 22, fontSize: 13, fontWeight: 600, color: OH.c.ink2 }}>
        <span>For families</span>
        <span>For caregivers</span>
        <span>Trust &amp; safety</span>
        <span>Help</span>
      </nav>
      <div style={{ display: 'flex', gap: 10 }}>
        <Link href="/signin" style={headerSignInStyle}>
          Sign in
        </Link>
        <a href="https://ourhavenapp.com" style={headerDownloadStyle}>
          Download the app
        </a>
      </div>
    </header>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: OH.c.ink2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={inputStyle} />;
}

function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={inputStyle} />;
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('message' in err) return String((err as { message: unknown }).message);
    if ('error' in err) return String((err as { error: unknown }).error);
  }
  return 'Sign-up failed.';
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: OH.c.canvas,
};

const headerStyle: CSSProperties = {
  height: 64,
  padding: '0 36px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  maxWidth: 1240,
  margin: '0 auto',
};

const logoMarkStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  background: OH.c.ink,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 13,
  color: OH.c.inkInv,
};

const headerSignInStyle: CSSProperties = {
  height: 38,
  padding: '0 14px',
  borderRadius: 999,
  border: `1.5px solid ${OH.c.ink}`,
  background: 'transparent',
  color: OH.c.ink,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const headerDownloadStyle: CSSProperties = {
  height: 38,
  padding: '0 16px',
  borderRadius: 999,
  background: OH.c.ink,
  color: OH.c.inkInv,
  fontSize: 12,
  fontWeight: 700,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const layoutStyle: CSSProperties = {
  padding: '32px 36px 56px',
  maxWidth: 1180,
  margin: '0 auto',
  display: 'grid',
  gridTemplateColumns: '1fr 460px',
  gap: 48,
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 999,
  background: OH.c.surface,
  boxShadow: OH.shadow.e1,
  fontSize: 12,
  fontWeight: 600,
  color: OH.c.ink2,
  marginBottom: 18,
};

const heroTitleStyle: CSSProperties = {
  fontSize: 54,
  lineHeight: '60px',
  fontWeight: 700,
  letterSpacing: -1.8,
  color: OH.c.ink,
  margin: '0 0 16px',
};

const heroSubtitleStyle: CSSProperties = {
  fontSize: 17,
  color: OH.c.ink2,
  margin: 0,
  maxWidth: 580,
  lineHeight: '26px',
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: OH.c.ink2,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 14,
};

const stepRowStyle: CSSProperties = {
  display: 'flex',
  gap: 18,
  padding: '14px 0',
  borderTop: `1px solid ${OH.c.hairline}`,
};

const stepNumStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  background: OH.c.surface,
  boxShadow: OH.shadow.e1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 700,
  color: OH.c.ink,
};

const trustStripStyle: CSSProperties = {
  marginTop: 32,
  padding: 22,
  borderRadius: 24,
  background: OH.c.ink,
  color: OH.c.inkInv,
  display: 'flex',
  gap: 28,
  flexWrap: 'wrap',
};

const formCardStyle: CSSProperties = {
  background: OH.c.surface,
  borderRadius: 28,
  padding: 28,
  boxShadow: OH.shadow.e2,
  border: `1.5px solid ${OH.c.hairline}`,
};

const tabBarStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 6,
  padding: 4,
  background: OH.c.surfaceAlt,
  borderRadius: 16,
  marginBottom: 22,
};

const tabBtnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 6px',
  borderRadius: 12,
  border: '1.5px solid',
  cursor: 'pointer',
  textAlign: 'center',
};

const formTitleStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  color: OH.c.ink,
  margin: '0 0 18px',
  letterSpacing: -0.6,
};

const fieldBlockStyle: CSSProperties = {
  marginBottom: 12,
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 50,
  padding: '0 14px',
  borderRadius: 14,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  fontSize: 14,
  color: OH.c.ink,
  outline: 'none',
};

const ctaPrimaryStyle: CSSProperties = {
  width: '100%',
  height: 52,
  borderRadius: 999,
  background: OH.c.brand,
  color: OH.c.inkInv,
  border: 'none',
  fontSize: 14,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const subCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  padding: 12,
  borderRadius: 14,
  border: '1.5px solid',
  cursor: 'pointer',
  minHeight: 70,
};

const specialtyRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1.5px solid',
  cursor: 'pointer',
  textAlign: 'left',
};

const consentRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: 12,
  background: OH.c.surfaceAlt,
  borderRadius: 12,
  marginBottom: 16,
  cursor: 'pointer',
  alignItems: 'flex-start',
  position: 'relative',
};

const permanenceNoteStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'flex-start',
  fontSize: 11,
  color: OH.c.ink2,
  lineHeight: '15px',
  margin: '0 0 14px',
};

const storeBtnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  height: 56,
  padding: '0 16px',
  borderRadius: 14,
  textDecoration: 'none',
  border: '1.5px solid',
};

const parentBulletsStyle: CSSProperties = {
  marginTop: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const parentBulletIconStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  background: OH.c.brandSoft,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const footerHintStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 11,
  color: OH.c.ink3,
  textAlign: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};

const errorStyle: CSSProperties = { color: OH.c.danger, marginTop: 10, fontSize: 13 };
const successStyle: CSSProperties = { color: OH.c.success, marginTop: 10, fontSize: 13 };
