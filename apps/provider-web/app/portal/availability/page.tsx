'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  AVAILABILITY_BANDS,
  AVAILABILITY_DAYS,
  AVAILABILITY_NOTE_MAX_CHARS,
  BAND_CLOCK_HOURS,
  isAvailable,
  renderAvailabilitySummary,
  type AvailabilityBand,
  type AvailabilityDay,
  type AvailabilityGrid,
} from '@our-haven/shared';

import { Icon } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';
import {
  getProviderProfile,
  patchProviderProfile,
  type ApiError,
  type ProviderProfile,
} from '@/lib/api';
import { PageFrame, WebAppBar } from '@/lib/portal/PortalShell';
import { getAccessToken } from '@/lib/supabase';

const DAY_FULL: Record<AvailabilityDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const BAND_FULL: Record<AvailabilityBand, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

function bandTimeLabel(band: AvailabilityBand): string {
  const { startHour, endHour } = BAND_CLOCK_HOURS[band];
  return `${formatHour(startHour)}–${formatHour(endHour)}`;
}

function formatHour(h: number): string {
  const suffix = h >= 12 && h < 24 ? 'pm' : 'am';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

function toggleCell(grid: AvailabilityGrid, day: AvailabilityDay, band: AvailabilityBand): AvailabilityGrid {
  const next: AvailabilityGrid = { ...grid, [day]: { ...(grid[day] ?? {}) } };
  const dayBands = next[day]!;
  dayBands[band] = !isAvailable(grid, day, band);
  return next;
}

function dollars(cents: number | null, unit: 'hour' | 'session'): string {
  if (cents === null) return `Not set / ${unit === 'hour' ? 'hr' : 'session'}`;
  return `$${(cents / 100).toFixed(0)}/${unit === 'hour' ? 'hr' : 'session'}`;
}

export default function AvailabilityPage() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [grid, setGrid] = useState<AvailabilityGrid>({});
  const [note, setNote] = useState('');
  const [paused, setPaused] = useState(false);
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
          setError('Sign in to edit your availability.');
          setLoading(false);
          return;
        }
        setToken(accessToken);
        const p = await getProviderProfile(accessToken);
        if (!alive) return;
        setProfile(p);
        setGrid(p.availabilityGrid ?? {});
        setNote(p.availabilityNote ?? '');
        setPaused(p.paused);
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

  const summary = useMemo(() => renderAvailabilitySummary(grid), [grid]);

  async function save() {
    if (!token || !profile) return;
    setError(null);
    setSuccessAt(null);
    setSaving(true);
    try {
      const updated = await patchProviderProfile(token, {
        availabilityGrid: grid,
        availabilityNote: note.trim() === '' ? null : note.trim(),
        paused,
      });
      setProfile(updated);
      setGrid(updated.availabilityGrid ?? {});
      setNote(updated.availabilityNote ?? '');
      setPaused(updated.paused);
      setSuccessAt(Date.now());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageFrame active="availability">
      <WebAppBar
        eyebrow="Availability"
        title="Your weekly summary"
        primary={{
          label: 'Publish changes',
          onClick: save,
          disabled: loading || !profile,
          busy: saving,
        }}
      />

      {loading && <Status>Loading…</Status>}
      {error && <Status tone="danger">{error}</Status>}
      {successAt && !error && <Status tone="success">Saved.</Status>}

      {profile && (
        <div style={layoutStyle}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div>
                  <Eyebrow>Structured grid</Eyebrow>
                  <p style={cardLeadStyle}>
                    Toggle the bands you&apos;re typically open. Parents see a short string like{' '}
                    <em>{summary ?? 'Weekdays, evenings'}</em> on search cards. Mapping is platform-fixed —
                    Morning {bandTimeLabel('morning')}, Afternoon {bandTimeLabel('afternoon')}, Evening{' '}
                    {bandTimeLabel('evening')}.
                  </p>
                </div>
              </div>

              <div style={gridStyle}>
                <div />
                {AVAILABILITY_BANDS.map((b) => (
                  <div key={b} style={gridHeaderStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: OH.c.ink }}>{BAND_FULL[b]}</div>
                    <div style={{ fontSize: 10, color: OH.c.ink3, marginTop: 2 }}>{bandTimeLabel(b)}</div>
                  </div>
                ))}
                {AVAILABILITY_DAYS.map((day) => (
                  <DayRow
                    key={day}
                    day={day}
                    grid={grid}
                    onToggle={(band) => setGrid((g) => toggleCell(g, day, band))}
                  />
                ))}
              </div>

              <div style={legendStyle}>
                <Legend swatch={OH.c.brand} label="Open" />
                <Legend swatch={OH.c.surface} outline label="Closed" />
              </div>
            </section>

            <section style={cardStyle}>
              <Eyebrow>Free-text note</Eyebrow>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, AVAILABILITY_NOTE_MAX_CHARS))}
                placeholder="Optional context — e.g. ‘Flexible weekends, last-minute OK.’"
                maxLength={AVAILABILITY_NOTE_MAX_CHARS}
                style={textareaStyle}
              />
              <div style={{ marginTop: 4, fontSize: 11, color: OH.c.ink3, fontVariantNumeric: 'tabular-nums' }}>
                {note.length} / {AVAILABILITY_NOTE_MAX_CHARS}
              </div>
            </section>

            <section style={cardStyle}>
              <Eyebrow>Pause new requests</Eyebrow>
              <ToggleRow
                checked={paused}
                onChange={setPaused}
                title="I'm not accepting new bookings right now"
                blurb="Paused profiles are hidden from Parent search. Existing Bookings continue. Switch this back off any time."
              />
            </section>
          </div>

          <aside style={previewColStyle}>
            <RateCard profile={profile} />
            <SummaryCard summary={summary} paused={paused} note={note} />
          </aside>
        </div>
      )}
    </PageFrame>
  );
}

function DayRow({
  day,
  grid,
  onToggle,
}: {
  day: AvailabilityDay;
  grid: AvailabilityGrid;
  onToggle: (band: AvailabilityBand) => void;
}) {
  return (
    <>
      <div style={dayLabelStyle}>
        <span style={{ fontSize: 13, fontWeight: 700, color: OH.c.ink }}>{DAY_FULL[day].slice(0, 3)}</span>
        <span style={{ fontSize: 10, color: OH.c.ink3 }}>{DAY_FULL[day]}</span>
      </div>
      {AVAILABILITY_BANDS.map((band) => {
        const on = isAvailable(grid, day, band);
        return (
          <button
            type="button"
            key={band}
            onClick={() => onToggle(band)}
            aria-pressed={on}
            style={{
              ...cellBtnStyle,
              background: on ? OH.c.brand : OH.c.surfaceAlt,
              color: on ? OH.c.inkInv : OH.c.ink2,
              borderColor: on ? OH.c.brand : OH.c.hairline,
            }}
          >
            {on ? 'Open' : ''}
          </button>
        );
      })}
    </>
  );
}

function RateCard({ profile }: { profile: ProviderProfile }) {
  const rate = dollars(profile.publishedRateCents, profile.rateUnit);
  return (
    <div style={previewCardStyle}>
      <Eyebrow>Your rate</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: OH.c.ink,
            letterSpacing: -1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {rate}
        </span>
      </div>
      <div style={{ fontSize: 12, color: OH.c.ink2 }}>
        Edit your rate on the{' '}
        <a href="/portal/profile" style={{ color: OH.c.ink, fontWeight: 700, textDecoration: 'underline' }}>
          Profile
        </a>{' '}
        page. Stripe Connect takes 18%; the rest lands in your account.
      </div>
      {profile.multiChildSurchargeEligible && profile.perChildSurchargeCents !== null && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: OH.c.surfaceAlt,
            borderRadius: 14,
            fontSize: 12,
            color: OH.c.ink2,
            lineHeight: '17px',
          }}
        >
          Per-child surcharge:{' '}
          <strong style={{ color: OH.c.ink }}>
            +${(profile.perChildSurchargeCents / 100).toFixed(2)}/hr
          </strong>{' '}
          for each Child beyond the first.
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  summary,
  paused,
  note,
}: {
  summary: string | null;
  paused: boolean;
  note: string;
}) {
  return (
    <div style={previewCardStyle}>
      <Eyebrow>Search-card preview</Eyebrow>
      <div
        style={{
          padding: 12,
          background: OH.c.canvas,
          borderRadius: 14,
          fontSize: 13,
          color: OH.c.ink,
          lineHeight: '18px',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 999,
            background: paused ? OH.c.surfaceAlt : OH.c.catSpec,
            fontSize: 11,
            fontWeight: 700,
            color: paused ? OH.c.ink2 : OH.c.ink,
            marginBottom: 8,
          }}
        >
          <Icon name="clock" size={12} color={paused ? OH.c.ink2 : OH.c.ink} />
          {paused ? 'Paused — hidden from search' : summary ?? 'No bands set'}
        </div>
        {note.trim() && (
          <div style={{ marginTop: 4, fontSize: 12, color: OH.c.ink2, lineHeight: '17px' }}>
            “{note.trim()}”
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow(props: {
  title: string;
  blurb: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: 14,
        borderRadius: 16,
        background: OH.c.surface,
        border: `1px solid ${OH.c.hairline}`,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 999,
          background: props.checked ? OH.c.brand : OH.c.surfaceAlt,
          border: props.checked ? 'none' : `1px solid ${OH.c.hairline}`,
          position: 'relative',
          cursor: 'pointer',
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

function Legend({ swatch, outline, label }: { swatch: string; outline?: boolean; label: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: swatch,
          border: outline ? `1px solid ${OH.c.hairline}` : 'none',
        }}
      />
      <span style={{ fontSize: 12, color: OH.c.ink2 }}>{label}</span>
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
  alignItems: 'flex-start',
  marginBottom: 18,
  gap: 24,
};

const cardLeadStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: OH.c.ink2,
  lineHeight: '19px',
  maxWidth: 560,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '110px repeat(3, 1fr)',
  gap: 8,
  alignItems: 'stretch',
};

const gridHeaderStyle: CSSProperties = {
  paddingBottom: 6,
  borderBottom: `1px solid ${OH.c.hairline}`,
};

const dayLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  paddingLeft: 4,
};

const cellBtnStyle: CSSProperties = {
  height: 48,
  borderRadius: 12,
  border: '1.5px solid',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const legendStyle: CSSProperties = {
  marginTop: 18,
  display: 'flex',
  gap: 18,
  alignItems: 'center',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 100,
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
