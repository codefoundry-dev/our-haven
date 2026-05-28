'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { Icon } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';
import {
  getProviderProfile,
  patchProviderProfile,
  type ApiError,
  type ProviderProfile,
  type ProviderProfilePatch,
} from '@/lib/api';
import { PageFrame, WebAppBar } from '@/lib/portal/PortalShell';
import { getAccessToken } from '@/lib/supabase';

interface FormState {
  displayName: string;
  headline: string;
  bio: string;
  languages: string;
  specialtyTags: string;
  publishedRateDollars: string;
  perChildSurchargeDollars: string;
  w10TaxCreditFriendly: boolean;
}

function profileToForm(p: ProviderProfile): FormState {
  return {
    displayName: p.displayName ?? '',
    headline: p.headline ?? '',
    bio: p.bio ?? '',
    languages: p.languages.join(', '),
    specialtyTags: p.specialtyTags.join(', '),
    publishedRateDollars:
      p.publishedRateCents !== null ? (p.publishedRateCents / 100).toFixed(2) : '',
    perChildSurchargeDollars:
      p.perChildSurchargeCents !== null ? (p.perChildSurchargeCents / 100).toFixed(2) : '',
    w10TaxCreditFriendly: p.w10TaxCreditFriendly,
  };
}

function parseDollarCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function splitCsv(raw: string, max = 40): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= max);
}

function categoryLabel(p: ProviderProfile): string {
  if (p.kind === 'caregiver' && p.caregiverCategory) {
    return p.caregiverCategory.charAt(0).toUpperCase() + p.caregiverCategory.slice(1);
  }
  if (p.kind === 'specialist' && p.specialty) {
    const map: Record<string, string> = {
      slp: 'Speech-Language Pathology',
      ot: 'Occupational Therapy',
      aba: 'Applied Behavior Analysis',
      psychology: 'Psychology',
      other: 'Other clinical',
    };
    return map[p.specialty] ?? p.specialty;
  }
  return p.kind;
}

function rateUnitSuffix(p: ProviderProfile): string {
  return p.rateUnit === 'hour' ? '/hr' : '/session';
}

export default function ProfilePage() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successAt, setSuccessAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!alive) return;
        if (!accessToken) {
          setError('Sign in to edit your profile.');
          setLoading(false);
          return;
        }
        setToken(accessToken);
        const p = await getProviderProfile(accessToken);
        if (!alive) return;
        setProfile(p);
        setForm(profileToForm(p));
      } catch (err) {
        if (!alive) return;
        setError(formatError(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (!token || !profile || !form) return;
    setError(null);
    setSuccessAt(null);
    setSaving(true);
    try {
      const patch: ProviderProfilePatch = {
        displayName: form.displayName.trim() === '' ? null : form.displayName.trim(),
        headline: form.headline.trim() === '' ? null : form.headline.trim(),
        bio: form.bio.trim() === '' ? null : form.bio.trim(),
        languages: splitCsv(form.languages),
        specialtyTags: splitCsv(form.specialtyTags),
        publishedRateCents: parseDollarCents(form.publishedRateDollars),
      };
      if (profile.multiChildSurchargeEligible) {
        patch.perChildSurchargeCents = parseDollarCents(form.perChildSurchargeDollars);
      }
      if (profile.w10Eligible) {
        patch.w10TaxCreditFriendly = form.w10TaxCreditFriendly;
      }
      const updated = await patchProviderProfile(token, patch);
      setProfile(updated);
      setForm(profileToForm(updated));
      setSuccessAt(Date.now());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageFrame active="profile">
      <WebAppBar
        eyebrow="Profile"
        title="What Parents see"
        primary={{ label: 'Publish changes', onClick: save, disabled: loading || !form, busy: saving }}
      />

      {loading && <Status>Loading…</Status>}
      {error && <Status tone="danger">{error}</Status>}
      {successAt && !error && <Status tone="success">Saved.</Status>}

      {form && profile && (
        <div style={layoutStyle}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={cardStyle}>
              <div style={cardHeaderStyle}>
                <Eyebrow>Identity</Eyebrow>
                <Tint>{categoryLabel(profile)}</Tint>
              </div>
              <Label>Display name</Label>
              <Field
                value={form.displayName}
                onChange={(v) => setForm({ ...form, displayName: v })}
                placeholder="How Parents see you (e.g. Maya G., OTR/L)"
                maxLength={80}
              />
              <div style={{ height: 14 }} />
              <Label>Headline</Label>
              <Field
                value={form.headline}
                onChange={(v) => setForm({ ...form, headline: v })}
                placeholder="One short line under your name"
                maxLength={120}
              />
              <CharCount value={form.headline} max={120} />
            </section>

            <section style={cardStyle}>
              <Eyebrow>Bio</Eyebrow>
              <Label>About</Label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Tell Parents how you work — experience, age groups, approach. Off-platform contact details are auto-scrubbed before publishing."
                maxLength={600}
                style={textareaStyle}
              />
              <CharCount value={form.bio} max={600} />
            </section>

            <section style={cardStyle}>
              <Eyebrow>Services &amp; rates</Eyebrow>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <Label>Published rate ({rateUnitSuffix(profile).slice(1)})</Label>
                  <DollarField
                    value={form.publishedRateDollars}
                    onChange={(v) => setForm({ ...form, publishedRateDollars: v })}
                    placeholder="0.00"
                  />
                  <Hint>
                    Caregivers publish hourly; Specialists per session. Negotiable through Offers in the chat.
                  </Hint>
                </div>
                <div>
                  <Label>
                    Per-child surcharge (per hour)
                    {!profile.multiChildSurchargeEligible && <Pill>Babysitter / Nanny only</Pill>}
                  </Label>
                  <DollarField
                    value={form.perChildSurchargeDollars}
                    onChange={(v) => setForm({ ...form, perChildSurchargeDollars: v })}
                    placeholder="0.00"
                    disabled={!profile.multiChildSurchargeEligible}
                  />
                  <Hint>
                    Flat hourly uplift for every Child beyond the first on a multi-child Booking.
                  </Hint>
                </div>
              </div>
            </section>

            <section style={cardStyle}>
              <Eyebrow>Tax-credit friendliness</Eyebrow>
              <ToggleRow
                disabled={!profile.w10Eligible}
                checked={form.w10TaxCreditFriendly}
                onChange={(v) => setForm({ ...form, w10TaxCreditFriendly: v })}
                title="I'll issue IRS Form W-10 on request"
                blurb={
                  profile.w10Eligible
                    ? 'Self-attest you\'ll provide a W-10 so Parents claiming the Child & Dependent Care Tax Credit (CDCTC) can find you. Search badge only — not a tax-validity guarantee.'
                    : 'CDCTC eligibility is only relevant for Babysitter and Nanny Providers.'
                }
              />
            </section>

            <section style={cardStyle}>
              <Eyebrow>Tags &amp; languages</Eyebrow>
              <Label>Specialty tags (comma-separated, up to 20)</Label>
              <Field
                value={form.specialtyTags}
                onChange={(v) => setForm({ ...form, specialtyTags: v })}
                placeholder="e.g. infants, twins, IEP support"
                maxLength={500}
              />
              <div style={{ height: 14 }} />
              <Label>Languages (comma-separated, up to 10)</Label>
              <Field
                value={form.languages}
                onChange={(v) => setForm({ ...form, languages: v })}
                placeholder="e.g. English, Spanish"
                maxLength={300}
              />
            </section>
          </div>

          <aside style={previewColStyle}>
            <PreviewCard profile={profile} form={form} />
            <ChecklistCard profile={profile} form={form} />
          </aside>
        </div>
      )}
    </PageFrame>
  );
}

function PreviewCard({ profile, form }: { profile: ProviderProfile; form: FormState }) {
  const rateCents = parseDollarCents(form.publishedRateDollars);
  const rateText =
    rateCents !== null ? `$${(rateCents / 100).toFixed(0)}${rateUnitSuffix(profile)}` : '—';
  const displayName = form.displayName.trim() || 'Your name';
  const bioPreview = form.bio.trim() ? form.bio.trim().slice(0, 110) : 'Your bio appears here.';
  const tags = splitCsv(form.specialtyTags).slice(0, 5);
  if (form.w10TaxCreditFriendly && profile.w10Eligible) tags.push('Tax-credit');
  return (
    <div style={previewCardStyle}>
      <Eyebrow>Live preview · Parent view</Eyebrow>
      <div style={previewInnerStyle}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar name={displayName} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: OH.c.ink, lineHeight: '20px' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 12, color: OH.c.ink2, marginTop: 2 }}>{categoryLabel(profile)}</div>
          </div>
        </div>
        {form.headline.trim() && (
          <div style={{ fontSize: 13, fontWeight: 600, color: OH.c.ink, marginTop: 14 }}>
            {form.headline.trim()}
          </div>
        )}
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {tags.map((t) => (
              <span key={t} style={tagStyle}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: OH.c.ink2, lineHeight: '17px', marginTop: 12 }}>{bioPreview}</div>
        <div style={previewFooterStyle}>
          <div>
            <div style={{ fontSize: 11, color: OH.c.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>From</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: OH.c.ink, fontVariantNumeric: 'tabular-nums' }}>
              {rateText}
            </div>
          </div>
          <button type="button" style={msgBtnStyle} disabled>
            Message
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistCard({ profile, form }: { profile: ProviderProfile; form: FormState }) {
  const items = [
    { label: 'Display name set', ok: form.displayName.trim().length >= 2 },
    { label: 'Headline set', ok: form.headline.trim().length >= 4 },
    { label: 'Bio at least 120 chars', ok: form.bio.trim().length >= 120 },
    {
      label: `Published ${profile.rateUnit === 'hour' ? 'hourly' : 'per-session'} rate`,
      ok: parseDollarCents(form.publishedRateDollars) !== null,
    },
  ];
  if (profile.multiChildSurchargeEligible) {
    items.push({
      label: 'Per-child surcharge decided',
      ok: parseDollarCents(form.perChildSurchargeDollars) !== null,
    });
  }
  const done = items.filter((i) => i.ok).length;
  const pct = items.length === 0 ? 100 : Math.round((done / items.length) * 100);
  return (
    <div style={previewCardStyle}>
      <Eyebrow>Profile completeness</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 6, marginBottom: 12 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: OH.c.ink,
            letterSpacing: -1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pct}%
        </span>
        <span style={{ fontSize: 12, color: OH.c.ink2, marginBottom: 6 }}>
          · {items.length - done} item{items.length - done === 1 ? '' : 's'} left
        </span>
      </div>
      {items.map((i) => (
        <div
          key={i.label}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: i.ok ? OH.c.success : 'transparent',
              border: i.ok ? 'none' : `1.5px dashed ${OH.c.hairline}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {i.ok && <Icon name="check" size={11} color={OH.c.inkInv} />}
          </span>
          <span
            style={{
              fontSize: 12,
              color: i.ok ? OH.c.ink2 : OH.c.ink,
              textDecoration: i.ok ? 'line-through' : 'none',
            }}
          >
            {i.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 999,
        background: OH.c.catSpec,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontWeight: 700,
        fontSize: 18,
        color: OH.c.ink,
      }}
    >
      {initials || '·'}
    </div>
  );
}

function Field(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      disabled={props.disabled}
      style={{
        ...inputStyle,
        background: props.disabled ? OH.c.surfaceAlt : OH.c.surface,
        cursor: props.disabled ? 'not-allowed' : 'text',
        opacity: props.disabled ? 0.6 : 1,
      }}
    />
  );
}

function DollarField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        ...inputStyle,
        background: props.disabled ? OH.c.surfaceAlt : OH.c.surface,
        opacity: props.disabled ? 0.6 : 1,
        padding: '0 14px',
      }}
    >
      <span style={{ color: OH.c.ink2, fontWeight: 600 }}>$</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? '0.00'}
        inputMode="decimal"
        disabled={props.disabled}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 14,
          color: OH.c.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  );
}

function ToggleRow(props: {
  title: string;
  blurb: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: 14,
        borderRadius: 16,
        background: props.disabled ? OH.c.surfaceAlt : OH.c.surface,
        border: `1px solid ${OH.c.hairline}`,
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={() => !props.disabled && props.onChange(!props.checked)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 999,
          background: props.checked ? OH.c.brand : OH.c.surfaceAlt,
          border: props.checked ? 'none' : `1px solid ${OH.c.hairline}`,
          position: 'relative',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          padding: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: props.checked ? 20 : 2,
            width: 22,
            height: 22,
            borderRadius: 999,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            transition: 'left 120ms',
          }}
        />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: OH.c.ink }}>{props.title}</div>
        <div style={{ fontSize: 12, color: OH.c.ink2, marginTop: 4, lineHeight: '17px' }}>{props.blurb}</div>
      </div>
    </div>
  );
}

function Status({ tone, children }: { tone?: 'success' | 'danger'; children: React.ReactNode }) {
  const color = tone === 'danger' ? OH.c.danger : tone === 'success' ? OH.c.success : OH.c.ink2;
  return (
    <div style={{ padding: '0 36px', marginTop: -8, marginBottom: 12, fontSize: 13, color }}>{children}</div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: OH.c.ink2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
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
        letterSpacing: 0.4,
        marginBottom: 6,
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <div style={{ marginTop: 4, fontSize: 11, color: OH.c.ink3, fontVariantNumeric: 'tabular-nums' }}>
      {value.length} / {max}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: OH.c.ink2, lineHeight: '15px' }}>{children}</div>
  );
}

function Tint({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: OH.c.surfaceAlt,
        fontSize: 11,
        fontWeight: 600,
        color: OH.c.ink2,
      }}
    >
      {children}
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 999,
        background: OH.c.surfaceAlt,
        fontSize: 10,
        fontWeight: 600,
        color: OH.c.ink3,
        textTransform: 'none',
        letterSpacing: 0,
      }}
    >
      {children}
    </span>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as ApiError;
    if (e.reason) return e.reason;
    if (e.error) return e.error;
  }
  return 'Something went wrong. Please try again.';
}

const layoutStyle: CSSProperties = {
  padding: '0 36px 40px',
  display: 'flex',
  gap: 24,
};

const cardStyle: CSSProperties = {
  background: OH.c.surface,
  borderRadius: 28,
  padding: 24,
  boxShadow: OH.shadow.e1,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 4,
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 14px',
  borderRadius: 12,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  fontSize: 14,
  color: OH.c.ink,
  outline: 'none',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 120,
  padding: 14,
  borderRadius: 12,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  fontSize: 13,
  color: OH.c.ink,
  outline: 'none',
  fontFamily: 'inherit',
  lineHeight: '19px',
  resize: 'vertical',
};

const previewColStyle: CSSProperties = {
  width: 320,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const previewCardStyle: CSSProperties = {
  background: OH.c.surface,
  borderRadius: 28,
  padding: 20,
  boxShadow: OH.shadow.e1,
};

const previewInnerStyle: CSSProperties = {
  background: OH.c.canvas,
  borderRadius: 22,
  padding: 16,
};

const previewFooterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 14,
  paddingTop: 14,
  borderTop: `1px solid ${OH.c.hairline}`,
};

const msgBtnStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  borderRadius: 999,
  border: 'none',
  background: OH.c.brand,
  color: OH.c.inkInv,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'not-allowed',
  opacity: 0.85,
};

const tagStyle: CSSProperties = {
  padding: '4px 9px',
  borderRadius: 999,
  background: OH.c.surface,
  fontSize: 10,
  fontWeight: 600,
  color: OH.c.ink,
  border: `1px solid ${OH.c.hairline}`,
};
