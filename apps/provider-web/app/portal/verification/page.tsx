'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Icon, type IconName } from '@/lib/design/Icon';
import { OH } from '@/lib/design/tokens';
import {
  confirmIdDocUpload,
  confirmInsuranceDocUpload,
  confirmLicenseDocUpload,
  confirmPhoneVerification,
  getSpecialistCredentials,
  getStripeConnectSummary,
  getVerification,
  requestIdDocSignedUrl,
  requestSignedUploadUrl,
  requestStripeConnectDashboardLink,
  requestStripeConnectOnboardingLink,
  type ApiError,
  type SpecialistCredentials,
  type StripeConnectSummary,
  type VerificationResponse,
  type VerificationState,
} from '@/lib/api';
import {
  getAccessToken,
  startPhoneOtpChange,
  uploadToSignedUrl,
  verifyPhoneOtp,
} from '@/lib/supabase';

type StepState = 'done' | 'in-progress' | 'action' | 'optional' | 'pending';

interface Step {
  n: number;
  title: string;
  state: StepState;
  detail: string;
  meta: string;
  sub?: string;
  cta?: 'phone' | 'id-doc' | 'bank';
}

const ID_DOC_ACCEPT = 'image/jpeg,image/png,application/pdf';
const ID_DOC_MAX_BYTES = 15 * 1024 * 1024;
const LICENSE_DOC_MAX_BYTES = 15 * 1024 * 1024;
const INSURANCE_DOC_MAX_BYTES = 15 * 1024 * 1024;

export default function VerificationPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [credentials, setCredentials] = useState<SpecialistCredentials | null>(null);
  const [connect, setConnect] = useState<StripeConnectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ID-doc upload UI
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // License + insurance upload UI (Specialist only)
  const licenseFileRef = useRef<HTMLInputElement>(null);
  const insuranceFileRef = useRef<HTMLInputElement>(null);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [insuranceUploading, setInsuranceUploading] = useState(false);
  const [licenseNumberDraft, setLicenseNumberDraft] = useState('');

  // Phone verification UI
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('+1');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Stripe Connect UI (OH-110)
  const [connectBusy, setConnectBusy] = useState(false);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [stripeNotice, setStripeNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const token = (await getAccessToken()) ?? '';
      if (!token) {
        setError('You\'re signed out. Please sign in again.');
        setLoading(false);
        return;
      }
      setAccessToken(token);
      const next = await getVerification(token);
      setData(next);
      // Credentials endpoint is Provider-only (clinical); 409 for Caregivers is fine to ignore.
      if (next.role === 'provider') {
        try {
          const creds = await getSpecialistCredentials(token);
          setCredentials(creds);
          setLicenseNumberDraft(creds.licenseNumber ?? '');
        } catch {
          // non-fatal — credentials block stays empty
        }
      }
      try {
        const summary = await getStripeConnectSummary(token);
        setConnect(summary);
      } catch {
        // non-fatal — the right rail just won't render the Stripe card.
      }
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // OH-110: when Stripe redirects back to ?stripe=return, the webhook may
  // already have updated the row; re-fetch the summary and show a heads-up.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripeFlag = params.get('stripe');
    if (stripeFlag === 'return') {
      setStripeNotice('Stripe returned you here. We\'re refreshing your account status.');
      void refresh();
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', url.toString());
    } else if (stripeFlag === 'refresh') {
      setStripeNotice('Stripe asked for a fresh link. Click "Continue with Stripe" to resume.');
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', url.toString());
    }
  }, [refresh]);

  const handleBankClick = useCallback(async () => {
    if (!accessToken) return;
    setConnectBusy(true);
    setError(null);
    try {
      const link = await requestStripeConnectOnboardingLink(accessToken);
      window.location.href = link.url;
    } catch (err) {
      setError(extractMessage(err));
      setConnectBusy(false);
    }
  }, [accessToken]);

  const handleDashboardClick = useCallback(async () => {
    if (!accessToken) return;
    setDashboardBusy(true);
    setError(null);
    try {
      const link = await requestStripeConnectDashboardLink(accessToken);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const message = extractMessage(err);
      const status = (err as ApiError | undefined)?.status;
      if (status === 403 && message === 'step_up_required') {
        setError(
          'Bank-detail edits and withdrawals require step-up MFA. Re-authenticate with TOTP from Account → Security, then try again.',
        );
      } else {
        setError(message);
      }
    } finally {
      setDashboardBusy(false);
    }
  }, [accessToken]);

  const handleIdDocClick = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const handleIdDocChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !accessToken) return;
      if (file.size > ID_DOC_MAX_BYTES) {
        setError(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 15MB.`);
        return;
      }
      const contentType =
        file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'application/pdf'
          ? file.type
          : null;
      if (!contentType) {
        setError('Only JPEG, PNG, or PDF files are accepted.');
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const signed = await requestIdDocSignedUrl(accessToken, contentType, file.size);
        await uploadToSignedUrl(signed.uploadUrl, file);
        const next = await confirmIdDocUpload(accessToken, signed.objectPath);
        setData(next);
      } catch (err) {
        setError(extractMessage(err));
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [accessToken],
  );

  const handleLicenseClick = useCallback(() => {
    licenseFileRef.current?.click();
  }, []);

  const handleInsuranceClick = useCallback(() => {
    insuranceFileRef.current?.click();
  }, []);

  const handleLicenseChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !accessToken || !credentials) return;
      if (file.size > LICENSE_DOC_MAX_BYTES) {
        setError(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 15MB.`);
        return;
      }
      const contentType =
        file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'application/pdf'
          ? file.type
          : null;
      if (!contentType) {
        setError('Only JPEG, PNG, or PDF files are accepted.');
        return;
      }
      setLicenseUploading(true);
      setError(null);
      try {
        const signed = await requestSignedUploadUrl(accessToken, 'license-doc', contentType, file.size);
        await uploadToSignedUrl(signed.uploadUrl, file);
        const trimmed = licenseNumberDraft.trim();
        const next = await confirmLicenseDocUpload(accessToken, {
          objectPath: signed.objectPath,
          licenseNumber: trimmed === '' ? null : trimmed,
          licenseBoardState: credentials.defaultBoard?.state ?? credentials.residentState,
        });
        setCredentials(next);
      } catch (err) {
        setError(extractMessage(err));
      } finally {
        setLicenseUploading(false);
        if (licenseFileRef.current) licenseFileRef.current.value = '';
      }
    },
    [accessToken, credentials, licenseNumberDraft],
  );

  const handleInsuranceChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !accessToken) return;
      if (file.size > INSURANCE_DOC_MAX_BYTES) {
        setError(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is 15MB.`);
        return;
      }
      const contentType =
        file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'application/pdf'
          ? file.type
          : null;
      if (!contentType) {
        setError('Only JPEG, PNG, or PDF files are accepted.');
        return;
      }
      setInsuranceUploading(true);
      setError(null);
      try {
        const signed = await requestSignedUploadUrl(accessToken, 'insurance-doc', contentType, file.size);
        await uploadToSignedUrl(signed.uploadUrl, file);
        const next = await confirmInsuranceDocUpload(accessToken, signed.objectPath);
        setCredentials(next);
      } catch (err) {
        setError(extractMessage(err));
      } finally {
        setInsuranceUploading(false);
        if (insuranceFileRef.current) insuranceFileRef.current.value = '';
      }
    },
    [accessToken],
  );

  const submitPhone = useCallback(async () => {
    if (!accessToken) return;
    setPhoneBusy(true);
    setPhoneError(null);
    try {
      if (!otpSent) {
        await startPhoneOtpChange(phone.trim());
        setOtpSent(true);
      } else {
        await verifyPhoneOtp(phone.trim(), otp.trim());
        const next = await confirmPhoneVerification(accessToken);
        setData(next);
        setPhoneOpen(false);
        setOtpSent(false);
        setOtp('');
      }
    } catch (err) {
      setPhoneError(extractMessage(err));
    } finally {
      setPhoneBusy(false);
    }
  }, [accessToken, otp, otpSent, phone]);

  const steps = useMemo<Step[]>(() => buildSteps(data, connect), [data, connect]);

  const completedCount = steps.filter((s) => s.state === 'done').length;
  const totalRequired = steps.filter((s) => s.state !== 'optional').length;

  return (
    <main style={pageStyle}>
      <Header email={data?.facts.emailConfirmedAt ? 'verified' : 'pending'} />

      <div style={{ padding: '0 36px 24px' }}>
        <ProgressStrip
          completed={completedCount}
          total={totalRequired}
          state={data?.state ?? 'unverified'}
          residentState={data?.residentState ?? null}
          licenseBoardSupported={data?.licenseBoardSupported ?? true}
        />
        {stripeNotice && (
          <div style={stripeNoticeStyle}>
            <Icon name="info" size={14} color={OH.c.brand} />
            <span>{stripeNotice}</span>
            <button
              type="button"
              onClick={() => setStripeNotice(null)}
              style={stripeNoticeDismissStyle}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '0 36px 40px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 540, background: OH.c.surface, borderRadius: 28, boxShadow: OH.shadow.e1, padding: 8 }}>
          {loading && <div style={emptyRowStyle}>Loading verification status…</div>}
          {!loading && error && <div style={{ ...emptyRowStyle, color: OH.c.danger }}>{error}</div>}
          {!loading && !error && steps.map((s) => (
            <div
              key={s.n}
              style={{
                display: 'flex',
                gap: 18,
                padding: '18px 20px',
                borderBottom: s.n === steps.length ? 'none' : `1px solid ${OH.c.hairline}`,
              }}
            >
              <div style={stepBubbleStyle}>{String(s.n).padStart(2, '0')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: OH.font, fontSize: 14, fontWeight: 700, color: OH.c.ink }}>{s.title}</span>
                  <StateBadge state={s.state} />
                </div>
                <div style={{ fontFamily: OH.font, fontSize: 13, color: OH.c.ink, marginBottom: 2 }}>{s.detail}</div>
                <div style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink2 }}>{s.meta}</div>
                {s.sub && (
                  <div style={{ fontFamily: OH.font, fontSize: 11, color: OH.c.ink3, marginTop: 4 }}>{s.sub}</div>
                )}
                {s.cta === 'phone' && s.state === 'action' && phoneOpen && (
                  <PhoneVerifyForm
                    phone={phone}
                    setPhone={setPhone}
                    otp={otp}
                    setOtp={setOtp}
                    otpSent={otpSent}
                    busy={phoneBusy}
                    error={phoneError}
                    onSubmit={submitPhone}
                    onCancel={() => {
                      setPhoneOpen(false);
                      setOtpSent(false);
                      setOtp('');
                      setPhoneError(null);
                    }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <StepCta
                  step={s}
                  busy={
                    s.cta === 'id-doc'
                      ? uploading
                      : s.cta === 'phone'
                        ? phoneBusy
                        : s.cta === 'bank'
                          ? connectBusy
                          : false
                  }
                  onClick={() => {
                    if (s.cta === 'id-doc') handleIdDocClick();
                    if (s.cta === 'phone') setPhoneOpen(true);
                    if (s.cta === 'bank') void handleBankClick();
                  }}
                />
              </div>
            </div>
          ))}
          {credentials && (
            <SpecialistCredentialsPanel
              credentials={credentials}
              licenseNumber={licenseNumberDraft}
              setLicenseNumber={setLicenseNumberDraft}
              licenseBusy={licenseUploading}
              insuranceBusy={insuranceUploading}
              onPickLicense={handleLicenseClick}
              onPickInsurance={handleInsuranceClick}
            />
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ID_DOC_ACCEPT}
            onChange={handleIdDocChange}
            style={{ display: 'none' }}
          />
          <input
            ref={licenseFileRef}
            type="file"
            accept={ID_DOC_ACCEPT}
            onChange={handleLicenseChange}
            style={{ display: 'none' }}
          />
          <input
            ref={insuranceFileRef}
            type="file"
            accept={ID_DOC_ACCEPT}
            onChange={handleInsuranceChange}
            style={{ display: 'none' }}
          />
        </div>

        <RightRail
          state={data?.state ?? 'unverified'}
          kind={data?.role === 'provider' ? 'specialist' : 'caregiver'}
          connect={connect}
          dashboardBusy={dashboardBusy}
          onOpenDashboard={() => void handleDashboardClick()}
        />
      </div>
    </main>
  );
}

function SpecialistCredentialsPanel(props: {
  credentials: SpecialistCredentials;
  licenseNumber: string;
  setLicenseNumber: (v: string) => void;
  licenseBusy: boolean;
  insuranceBusy: boolean;
  onPickLicense: () => void;
  onPickInsurance: () => void;
}) {
  const c = props.credentials;
  const supported = c.licenseBoardSupported && c.defaultBoard !== null;
  const licenseUploaded = !!c.licenseUploadedAt;
  const insuranceUploaded = !!c.insuranceUploadedAt;

  return (
    <div style={credentialsPanelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div
            style={{
              fontFamily: OH.font,
              fontSize: 11,
              fontWeight: 700,
              color: OH.c.ink2,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Specialist credentials
          </div>
          <div style={{ fontFamily: OH.font, fontSize: 16, fontWeight: 700, color: OH.c.ink, marginTop: 2 }}>
            {supported ? c.defaultBoard!.boardName : `License board adapter pending for ${c.residentState}`}
          </div>
        </div>
        {c.decision === 'verified' && (
          <span style={{ ...badgeStyle, background: 'rgba(47,122,77,0.12)', color: OH.c.success }}>
            <Icon name="check-circle" size={12} color={OH.c.success} /> Verified
          </span>
        )}
        {c.decision === 'rejected' && (
          <span style={{ ...badgeStyle, background: 'rgba(178,58,47,0.12)', color: OH.c.danger }}>
            <Icon name="info" size={12} color={OH.c.danger} /> Rejected
          </span>
        )}
        {c.decision === null && licenseUploaded && (
          <span style={{ ...badgeStyle, background: 'rgba(201,122,42,0.12)', color: OH.c.warning }}>
            <Icon name="clock" size={12} color={OH.c.warning} /> Awaiting admin review
          </span>
        )}
      </div>

      {!supported && (
        <div style={holdingStyle}>
          Specialists in <strong>{c.residentState}</strong> are on the holding list — we accept your application, but
          activation waits for the per-state license-board adapter. You can still upload your license + insurance now;
          we&apos;ll verify them as soon as your state goes live.
        </div>
      )}

      {supported && (
        <div style={boardCardStyle}>
          <div style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink2 }}>Your state license register</div>
          <a
            href={c.defaultBoard!.registerUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={registerLinkStyle}
          >
            <Icon name="arrow-right" size={14} color={OH.c.brand} />
            {c.defaultBoard!.registerUrl}
          </a>
          {c.defaultBoard!.hint && (
            <div style={{ fontFamily: OH.font, fontSize: 11, color: OH.c.ink3, marginTop: 4 }}>
              {c.defaultBoard!.hint}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <label style={fieldLabelStyle}>License number (optional, helps admin)</label>
        <input
          type="text"
          value={props.licenseNumber}
          onChange={(e) => props.setLicenseNumber(e.target.value)}
          maxLength={64}
          placeholder="e.g. OT12345"
          style={fieldInputStyle}
        />
      </div>

      <div style={uploadGridStyle}>
        <UploadRow
          label="License certificate"
          required
          uploaded={licenseUploaded}
          when={c.licenseUploadedAt}
          busy={props.licenseBusy}
          onClick={props.onPickLicense}
        />
        <UploadRow
          label="Liability insurance COI"
          required={false}
          uploaded={insuranceUploaded}
          when={c.insuranceUploadedAt}
          busy={props.insuranceBusy}
          onClick={props.onPickInsurance}
        />
      </div>

      {c.decision === 'rejected' && c.decisionNotes && (
        <div style={rejectedNoteStyle}>
          <strong>Admin notes:</strong> {c.decisionNotes}
        </div>
      )}
    </div>
  );
}

function UploadRow(props: {
  label: string;
  required: boolean;
  uploaded: boolean;
  when: string | null;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div style={uploadRowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: OH.font, fontSize: 13, fontWeight: 700, color: OH.c.ink }}>{props.label}</span>
          {!props.required && (
            <span
              style={{
                fontFamily: OH.font,
                fontSize: 10,
                fontWeight: 600,
                color: OH.c.ink2,
                background: OH.c.surfaceAlt,
                padding: '2px 8px',
                borderRadius: 999,
              }}
            >
              Optional
            </span>
          )}
        </div>
        <div style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink2, marginTop: 2 }}>
          {props.uploaded && props.when
            ? `Uploaded ${formatDate(props.when)}`
            : 'PDF, JPEG, or PNG · up to 15MB'}
        </div>
      </div>
      <button type="button" disabled={props.busy} onClick={props.onClick} style={ctaDarkStyle}>
        {props.busy ? 'Uploading…' : props.uploaded ? 'Replace' : 'Upload'}
      </button>
    </div>
  );
}

function buildSteps(data: VerificationResponse | null, connect: StripeConnectSummary | null): Step[] {
  const facts = data?.facts;
  const kind = data?.role === 'provider' ? 'specialist' : 'caregiver';

  const emailDone = !!facts?.emailConfirmedAt;
  const phoneDone = !!facts?.phoneConfirmedAt;
  const idDone = !!facts?.idDocUploadedAt;
  const screeningInitiated = !!facts?.screeningInitiatedAt;
  const screeningPassed = !!facts?.screeningPassedAt;
  const licenseVerified = !!facts?.licenseVerifiedAt;

  const accountState: StepState = emailDone && phoneDone ? 'done' : phoneDone ? 'action' : emailDone ? 'action' : 'action';
  const accountDetail = !data
    ? 'Email + phone'
    : emailDone && phoneDone
      ? 'Email + phone verified'
      : emailDone
        ? 'Email verified · phone still needed'
        : 'Email + phone pending';
  const accountMeta = emailDone && phoneDone && facts?.phoneConfirmedAt
    ? `Verified ${formatDate(facts.phoneConfirmedAt)}`
    : 'Required before profile can go live';

  const idState: StepState = !emailDone || !phoneDone ? 'pending' : idDone ? 'done' : 'action';
  const idDetail = idDone ? facts!.idDocObjectPath ?? 'Uploaded' : 'Driver license, passport, or state ID (JPEG / PNG / PDF, ≤15MB)';
  const idMeta = idDone && facts?.idDocUploadedAt
    ? `Uploaded ${formatDate(facts.idDocUploadedAt)}`
    : 'Uploaded once · used for Checkr identity match';

  const screeningState: StepState = screeningPassed
    ? 'done'
    : screeningInitiated
      ? 'in-progress'
      : idDone
        ? 'pending'
        : 'pending';
  const screeningDetail = screeningPassed
    ? 'Checkr standard package · cleared'
    : 'Checkr standard package — county criminal + national criminal + NSOR + SSN trace';
  const screeningMeta = screeningPassed && facts?.screeningPassedAt
    ? `Cleared ${formatDate(facts.screeningPassedAt)}`
    : screeningInitiated && facts?.screeningInitiatedAt
      ? `Submitted ${formatDate(facts.screeningInitiatedAt)} · typical turnaround 3–5 business days`
      : 'Unlocks after government-issued ID is uploaded';

  const licenseRequired = kind === 'specialist';
  const licenseSupported = data ? data.licenseBoardSupported : true;
  const licenseState: StepState = !licenseRequired
    ? 'optional'
    : licenseVerified
      ? 'done'
      : !screeningPassed
        ? 'pending'
        : licenseSupported
          ? 'action'
          : 'pending';
  const licenseDetail = !licenseRequired
    ? 'Not required for Caregiver accounts'
    : licenseSupported
      ? 'Upload license certificate — verified manually against your state board'
      : `Your state's license-board adapter is not yet shipped — verification will resume once it does`;
  const licenseMeta = !licenseRequired
    ? 'Caregivers (babysitter/tutor/nanny) only need Checkr'
    : licenseVerified && facts?.licenseVerifiedAt
      ? `Verified ${formatDate(facts.licenseVerifiedAt)}`
      : licenseSupported
        ? 'Required for Specialist activation'
        : 'You can still complete prior steps — your profile will unlock once your state is supported';

  const insuranceState: StepState = 'optional';
  const taxState: StepState = 'optional';
  const bankReady = !!connect?.accountReady;
  const bankSubmitted = !!connect?.detailsSubmitted;
  const bankState: StepState = bankReady
    ? 'done'
    : !screeningPassed
      ? 'pending'
      : bankSubmitted
        ? 'in-progress'
        : 'action';
  const bankDetail = bankReady
    ? 'Stripe Connect Express account ready — bookings can be paid out'
    : bankSubmitted
      ? 'Stripe is reviewing your details — we\'ll notify you once payouts unlock'
      : 'Required before your first payout — funds go directly to your account';
  const bankMeta = bankReady && connect?.accountReadyAt
    ? `Live since ${formatDate(connect.accountReadyAt)}`
    : bankSubmitted
      ? 'Submitted to Stripe · typical turnaround a few minutes'
      : screeningPassed
        ? 'Set up your Stripe Connect Express account'
        : 'Unlocks after Checkr clears';
  const bankSub = connect?.disabledReason
    ? `Stripe paused this account: ${connect.disabledReason}`
    : connect && connect.requirementsCurrentlyDue.length > 0
      ? `Stripe still needs: ${connect.requirementsCurrentlyDue.slice(0, 3).join(', ')}${connect.requirementsCurrentlyDue.length > 3 ? '…' : ''}`
      : undefined;

  const steps: Step[] = [
    {
      n: 1,
      title: 'Account basics',
      state: accountState,
      detail: accountDetail,
      meta: accountMeta,
      cta: phoneDone ? undefined : 'phone',
    },
    {
      n: 2,
      title: 'Government-issued ID',
      state: idState,
      detail: idDetail,
      meta: idMeta,
      cta: 'id-doc',
    },
    {
      n: 3,
      title: 'Checkr background screening',
      state: screeningState,
      detail: screeningDetail,
      meta: screeningMeta,
      sub: screeningInitiated && !screeningPassed ? '$35 fee charged · receipt sent to your email' : undefined,
    },
    {
      n: 4,
      title: 'Specialist license verification',
      state: licenseState,
      detail: licenseDetail,
      meta: licenseMeta,
    },
    {
      n: 5,
      title: 'Liability insurance (optional)',
      state: insuranceState,
      detail: 'Upload COI from your carrier — appears as an "Insured" badge on your profile',
      meta: 'Encouraged · not required',
    },
    {
      n: 6,
      title: 'Tax-credit-friendly disclosure (optional)',
      state: taxState,
      detail: 'Self-attest you\'ll issue Form W-10 on request so Parents can claim the CDCTC',
      meta: 'Adds a "Tax-credit-friendly" badge on Babysitter / Nanny profiles',
    },
    {
      n: 7,
      title: 'Bank details (Stripe Connect)',
      state: bankState,
      detail: bankDetail,
      meta: bankMeta,
      sub: bankSub,
      cta: bankState === 'action' || bankState === 'in-progress' ? 'bank' : undefined,
    },
  ];

  return steps;
}

function ProgressStrip({
  completed,
  total,
  state,
  residentState,
  licenseBoardSupported,
}: {
  completed: number;
  total: number;
  state: VerificationState;
  residentState: string | null;
  licenseBoardSupported: boolean;
}) {
  const ratio = total === 0 ? 0 : Math.min(1, completed / total);
  const dashArray = `${ratio * 207} 207`;
  const headline = headlineForState(state);
  const blurb = blurbForState(state, licenseBoardSupported);
  const eta = etaForState(state);
  return (
    <div style={progressStripStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={progressRingWrapStyle}>
          <svg width="78" height="78" viewBox="0 0 78 78">
            <circle cx="39" cy="39" r="33" fill="none" stroke={OH.c.surfaceAlt} strokeWidth="8" />
            <circle
              cx="39"
              cy="39"
              r="33"
              fill="none"
              stroke={OH.c.brand}
              strokeWidth="8"
              strokeDasharray={dashArray}
              strokeLinecap="round"
              transform="rotate(-90 39 39)"
            />
          </svg>
          <div style={progressRingLabelStyle}>
            {completed}/{total}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: OH.font, fontSize: 18, fontWeight: 700, color: OH.c.ink }}>{headline}</div>
          <div style={{ fontFamily: OH.font, fontSize: 13, color: OH.c.ink2, maxWidth: 360, lineHeight: '18px' }}>{blurb}</div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 28 }}>
        {[
          { l: 'Resident state', v: residentState ?? '—' },
          { l: 'Stage', v: stageLabel(state) },
          { l: 'ETA', v: eta },
        ].map((it) => (
          <div key={it.l} style={{ minWidth: 100 }}>
            <div
              style={{
                fontFamily: OH.font,
                fontSize: 11,
                color: OH.c.ink2,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
              }}
            >
              {it.l}
            </div>
            <div
              style={{
                fontFamily: OH.font,
                fontSize: 17,
                fontWeight: 700,
                color: OH.c.ink,
                marginTop: 2,
              }}
            >
              {it.v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: StepState }) {
  const map: Record<StepState, { l: string; bg: string; fg: string; icon: IconName }> = {
    done: { l: 'Cleared', bg: 'rgba(47,122,77,0.12)', fg: OH.c.success, icon: 'check-circle' },
    'in-progress': { l: 'In progress', bg: 'rgba(201,122,42,0.12)', fg: OH.c.warning, icon: 'clock' },
    action: { l: 'Action needed', bg: 'rgba(178,58,47,0.12)', fg: OH.c.danger, icon: 'info' },
    optional: { l: 'Optional', bg: OH.c.surfaceAlt, fg: OH.c.ink2, icon: 'plus' },
    pending: { l: 'Locked', bg: OH.c.surfaceAlt, fg: OH.c.ink3, icon: 'lock' },
  };
  const m = map[state];
  return (
    <span style={{ ...badgeStyle, background: m.bg, color: m.fg }}>
      <Icon name={m.icon} size={12} color={m.fg} /> {m.l}
    </span>
  );
}

function StepCta({ step, busy, onClick }: { step: Step; busy: boolean; onClick: () => void }) {
  if (step.state === 'action') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        style={ctaDarkStyle}
      >
        {busy
          ? 'Working…'
          : step.cta === 'id-doc'
            ? 'Upload'
            : step.cta === 'phone'
              ? 'Verify'
              : step.cta === 'bank'
                ? 'Set up Stripe'
                : 'Continue'}
      </button>
    );
  }
  if (step.state === 'optional') {
    return (
      <button type="button" style={ctaOutlineStyle} disabled>
        Add
      </button>
    );
  }
  if (step.state === 'done') {
    return <Icon name="check" size={20} color={OH.c.success} />;
  }
  if (step.state === 'in-progress') {
    if (step.cta === 'bank') {
      return (
        <button type="button" disabled={busy} onClick={onClick} style={ctaOutlineStyle}>
          {busy ? 'Working…' : 'Resume'}
        </button>
      );
    }
    return <Icon name="dots" size={20} color={OH.c.warning} />;
  }
  return <Icon name="lock" size={18} color={OH.c.ink3} />;
}

function PhoneVerifyForm(props: {
  phone: string;
  setPhone: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={phoneFormStyle}>
      <label style={phoneLabelStyle}>Mobile number (E.164)</label>
      <input
        type="tel"
        autoComplete="tel"
        disabled={props.otpSent}
        value={props.phone}
        onChange={(e) => props.setPhone(e.target.value)}
        style={phoneInputStyle}
        placeholder="+13055550199"
      />
      {props.otpSent && (
        <>
          <label style={{ ...phoneLabelStyle, marginTop: 10 }}>Code (sent via SMS)</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={props.otp}
            onChange={(e) => props.setOtp(e.target.value)}
            style={phoneInputStyle}
            placeholder="000000"
          />
        </>
      )}
      {props.error && <div style={{ fontSize: 12, color: OH.c.danger, marginTop: 8 }}>{props.error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={props.busy} onClick={props.onSubmit} style={ctaDarkStyle}>
          {props.busy ? 'Working…' : props.otpSent ? 'Verify code' : 'Send code'}
        </button>
        <button type="button" onClick={props.onCancel} style={ctaOutlineStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RightRail({
  state,
  kind,
  connect,
  dashboardBusy,
  onOpenDashboard,
}: {
  state: VerificationState;
  kind: 'caregiver' | 'specialist';
  connect: StripeConnectSummary | null;
  dashboardBusy: boolean;
  onOpenDashboard: () => void;
}) {
  return (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: OH.c.ink, color: OH.c.inkInv, borderRadius: 28, padding: 20, boxShadow: OH.shadow.e2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Icon name="info" size={16} color={OH.c.highlight} />
          <span
            style={{
              fontFamily: OH.font,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
            }}
          >
            {state === 'activated' ? 'Live and bookable' : 'Not yet visible'}
          </span>
        </div>
        <div style={{ fontFamily: OH.font, fontSize: 14, lineHeight: '20px', opacity: 0.85 }}>
          {state === 'activated'
            ? 'Your profile is published. Parents in your area can message and book you now.'
            : state === 'rejected'
              ? 'We weren\'t able to activate your account. Email support@ourhavenapp.com to discuss next steps.'
              : state === 'holding-state-not-supported'
                ? 'Your state\'s license-board adapter is not yet live. We\'ll notify you the moment it ships and resume your verification automatically.'
                : state === 'connect-pending'
                  ? 'Almost there — finish Stripe Connect onboarding so we can route Booking payouts to your bank.'
                  : 'Your profile is hidden from Parents until every required step clears. We\'ll send a push the moment you go live.'}
        </div>
      </div>

      {connect?.hasAccount && (
        <div style={{ background: OH.c.surface, borderRadius: 28, padding: 20, boxShadow: OH.shadow.e1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: OH.font, fontSize: 15, fontWeight: 600, color: OH.c.ink }}>Stripe Connect</div>
            <span
              style={{
                ...badgeStyle,
                background: connect.accountReady ? 'rgba(47,122,77,0.12)' : 'rgba(201,122,42,0.12)',
                color: connect.accountReady ? OH.c.success : OH.c.warning,
              }}
            >
              <Icon
                name={connect.accountReady ? 'check-circle' : 'clock'}
                size={12}
                color={connect.accountReady ? OH.c.success : OH.c.warning}
              />
              {connect.accountReady ? 'Enabled' : connect.detailsSubmitted ? 'Reviewing' : 'Pending'}
            </span>
          </div>
          <div style={connectSummaryListStyle}>
            <ConnectStat label="Charges" enabled={connect.chargesEnabled} />
            <ConnectStat label="Payouts" enabled={connect.payoutsEnabled} />
            <ConnectStat label="Details submitted" enabled={connect.detailsSubmitted} />
          </div>
          {connect.disabledReason && (
            <div style={connectAlertStyle}>
              <strong>Stripe paused this account:</strong> {connect.disabledReason}
            </div>
          )}
          {!connect.disabledReason && connect.requirementsCurrentlyDue.length > 0 && (
            <div style={connectRequirementsStyle}>
              <div
                style={{
                  fontFamily: OH.font,
                  fontSize: 11,
                  fontWeight: 600,
                  color: OH.c.ink2,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  marginBottom: 4,
                }}
              >
                Stripe still needs
              </div>
              {connect.requirementsCurrentlyDue.slice(0, 5).map((r) => (
                <div key={r} style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink, padding: '2px 0' }}>
                  · {r}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={dashboardBusy}
            onClick={onOpenDashboard}
            style={{ ...ctaOutlineStyle, width: '100%', marginTop: 12 }}
            title="Bank-detail edits and payout withdrawals — requires step-up MFA"
          >
            {dashboardBusy ? 'Opening Stripe…' : 'Manage in Stripe (MFA)'}
          </button>
        </div>
      )}

      <div style={{ background: OH.c.surface, borderRadius: 28, padding: 20, boxShadow: OH.shadow.e1 }}>
        <div style={{ fontFamily: OH.font, fontSize: 15, fontWeight: 600, color: OH.c.ink, marginBottom: 12 }}>
          What Checkr verifies
        </div>
        {[
          'State criminal records (per your resident state)',
          'FBI national criminal records',
          'National Sex Offender Registry',
          'County-level criminal records · 7 years',
          'Social Security number trace',
          'Global watchlist (OFAC, OIG)',
        ].map((l) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
            <Icon name="check" size={14} color={OH.c.success} />
            <span style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink }}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{ background: OH.c.surface, borderRadius: 28, padding: 20, boxShadow: OH.shadow.e1 }}>
        <div style={{ fontFamily: OH.font, fontSize: 15, fontWeight: 600, color: OH.c.ink, marginBottom: 4 }}>
          Stuck on something?
        </div>
        <div style={{ fontFamily: OH.font, fontSize: 12, color: OH.c.ink2, lineHeight: '17px', marginBottom: 12 }}>
          {kind === 'specialist'
            ? 'Specialist license verification can take a few business days while we look you up on your state board.'
            : 'We\'re a real, small team. Email and someone replies within a business day.'}
        </div>
        <a
          href="mailto:support@ourhavenapp.com"
          style={{
            display: 'block',
            textAlign: 'center',
            height: 40,
            lineHeight: '40px',
            borderRadius: 999,
            border: `1.5px solid ${OH.c.ink}`,
            background: OH.c.surface,
            color: OH.c.ink,
            fontFamily: OH.font,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          support@ourhavenapp.com
        </a>
      </div>
    </div>
  );
}

function ConnectStat({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <Icon
        name={enabled ? 'check-circle' : 'clock'}
        size={14}
        color={enabled ? OH.c.success : OH.c.ink3}
      />
      <span style={{ fontFamily: OH.font, fontSize: 12, color: enabled ? OH.c.ink : OH.c.ink2 }}>{label}</span>
    </div>
  );
}

function Header({ email }: { email: 'verified' | 'pending' }) {
  return (
    <header style={headerStyle}>
      <div>
        <div
          style={{
            fontFamily: OH.font,
            fontSize: 11,
            fontWeight: 700,
            color: OH.c.ink2,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Verification
        </div>
        <div style={{ fontFamily: OH.font, fontSize: 28, fontWeight: 700, color: OH.c.ink, letterSpacing: -0.7 }}>
          Trust &amp; safety checks
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: OH.c.surface,
            boxShadow: OH.shadow.e1,
            fontFamily: OH.font,
            fontSize: 12,
            color: email === 'verified' ? OH.c.success : OH.c.ink2,
            fontWeight: 600,
          }}
        >
          <Icon name={email === 'verified' ? 'check-circle' : 'info'} size={14} />
          {email === 'verified' ? 'Email verified' : 'Verify your email'}
        </span>
        <button
          aria-label="Notifications"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: OH.c.surface,
            boxShadow: OH.shadow.e1,
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="bell" size={16} color={OH.c.ink} />
        </button>
      </div>
    </header>
  );
}

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as ApiError & { message?: string };
    if (e.reason) return e.reason;
    if (e.error) return e.error;
    if (e.message) return e.message;
  }
  return 'Something went wrong.';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function headlineForState(state: VerificationState): string {
  switch (state) {
    case 'activated':
      return 'You\'re live';
    case 'rejected':
      return 'Verification rejected';
    case 'holding-state-not-supported':
      return 'Holding — state not yet supported';
    case 'screening-initiated':
      return 'Checkr is reviewing you';
    case 'license-pending':
      return 'License review pending';
    case 'connect-pending':
      return 'One step left — set up payouts';
    default:
      return 'Almost there';
  }
}

function blurbForState(state: VerificationState, licenseBoardSupported: boolean): string {
  if (state === 'activated') return 'Your profile is published. Parents in your area can find you in search.';
  if (state === 'rejected') return 'See email from support@ourhavenapp.com for details.';
  if (state === 'holding-state-not-supported') {
    return 'We accept Specialists from every US state, but the per-state license-board adapter for yours hasn\'t shipped yet. We\'ll resume automatically once it does.';
  }
  if (state === 'screening-initiated') {
    return 'Typical turnaround is 3–5 business days. You\'ll get an email + push the moment results land.';
  }
  if (state === 'license-pending') {
    return licenseBoardSupported
      ? 'Our team is verifying your license against your state board. This usually takes 1–2 business days.'
      : 'Holding for state adapter — we\'ll resume the moment your state goes live.';
  }
  if (state === 'connect-pending') {
    return 'Stripe Connect needs a couple of details so we can route Booking payouts to your bank. Your profile activates the moment Stripe confirms.';
  }
  return 'Knock these out and your profile goes live the moment Checkr clears.';
}

function stageLabel(state: VerificationState): string {
  switch (state) {
    case 'unverified':
      return 'Email';
    case 'email-verified':
      return 'Phone';
    case 'phone-verified':
      return 'ID upload';
    case 'id-uploaded':
      return 'Checkr';
    case 'screening-initiated':
      return 'Checkr review';
    case 'screening-passed':
      return 'License';
    case 'license-pending':
      return 'License board';
    case 'license-verified':
      return 'Stripe Connect';
    case 'connect-pending':
      return 'Stripe Connect';
    case 'activated':
      return 'Live';
    case 'rejected':
      return 'Rejected';
    case 'holding-state-not-supported':
      return 'Holding';
  }
}

function etaForState(state: VerificationState): string {
  switch (state) {
    case 'screening-initiated':
      return '3–5 days';
    case 'license-pending':
      return '1–2 days';
    case 'connect-pending':
      return 'Minutes';
    case 'activated':
      return 'Live';
    case 'rejected':
      return '—';
    case 'holding-state-not-supported':
      return 'TBD';
    default:
      return 'You';
  }
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: OH.c.canvas,
  fontFamily: OH.font,
};

const headerStyle: CSSProperties = {
  padding: '24px 36px',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 16,
};

const progressStripStyle: CSSProperties = {
  background: OH.c.surface,
  borderRadius: 28,
  padding: 24,
  boxShadow: OH.shadow.e1,
  display: 'flex',
  alignItems: 'center',
  gap: 24,
  flexWrap: 'wrap',
};

const progressRingWrapStyle: CSSProperties = {
  position: 'relative',
  width: 78,
  height: 78,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const progressRingLabelStyle: CSSProperties = {
  position: 'absolute',
  fontFamily: OH.font,
  fontSize: 20,
  fontWeight: 700,
  color: OH.c.ink,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: -0.5,
};

const stepBubbleStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  background: OH.c.surfaceAlt,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: OH.font,
  fontSize: 12,
  fontWeight: 700,
  color: OH.c.ink2,
  fontVariantNumeric: 'tabular-nums',
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontFamily: OH.font,
  fontSize: 11,
  fontWeight: 600,
};

const ctaDarkStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  borderRadius: 999,
  border: 'none',
  background: OH.c.ink,
  color: OH.c.inkInv,
  fontFamily: OH.font,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const ctaOutlineStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  borderRadius: 999,
  border: `1.5px solid ${OH.c.ink}`,
  background: OH.c.surface,
  color: OH.c.ink,
  fontFamily: OH.font,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyRowStyle: CSSProperties = {
  padding: '32px 20px',
  fontFamily: OH.font,
  fontSize: 14,
  color: OH.c.ink2,
  textAlign: 'center',
};

const phoneFormStyle: CSSProperties = {
  marginTop: 14,
  padding: 16,
  background: OH.c.surfaceAlt,
  borderRadius: 16,
};

const phoneLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: OH.font,
  fontSize: 11,
  fontWeight: 600,
  color: OH.c.ink2,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
};

const phoneInputStyle: CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 12px',
  borderRadius: 12,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  fontFamily: OH.font,
  fontSize: 14,
  color: OH.c.ink,
  outline: 'none',
};

const credentialsPanelStyle: CSSProperties = {
  margin: '8px',
  padding: 20,
  borderRadius: 22,
  background: OH.c.surfaceAlt,
  border: `1px solid ${OH.c.hairline}`,
};

const holdingStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: OH.c.surface,
  border: `1px solid ${OH.c.hairline}`,
  fontFamily: OH.font,
  fontSize: 13,
  color: OH.c.ink2,
  lineHeight: '19px',
};

const boardCardStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: OH.c.surface,
  border: `1px solid ${OH.c.hairline}`,
};

const registerLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  fontFamily: OH.font,
  fontSize: 13,
  color: OH.c.brand,
  textDecoration: 'underline',
  wordBreak: 'break-all',
};

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: OH.font,
  fontSize: 11,
  fontWeight: 600,
  color: OH.c.ink2,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 6,
};

const fieldInputStyle: CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 12px',
  borderRadius: 12,
  background: OH.c.surface,
  border: `1.5px solid ${OH.c.hairline}`,
  fontFamily: OH.font,
  fontSize: 14,
  color: OH.c.ink,
  outline: 'none',
};

const uploadGridStyle: CSSProperties = {
  marginTop: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const uploadRowStyle: CSSProperties = {
  display: 'flex',
  gap: 14,
  alignItems: 'center',
  padding: 14,
  borderRadius: 14,
  background: OH.c.surface,
  border: `1px solid ${OH.c.hairline}`,
};

const rejectedNoteStyle: CSSProperties = {
  marginTop: 14,
  padding: 12,
  borderRadius: 12,
  background: 'rgba(178,58,47,0.08)',
  fontFamily: OH.font,
  fontSize: 12,
  color: OH.c.ink,
  lineHeight: '17px',
};

const stripeNoticeStyle: CSSProperties = {
  marginTop: 12,
  padding: '10px 14px',
  borderRadius: 14,
  background: OH.c.brandSoft,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: OH.font,
  fontSize: 13,
  color: OH.c.ink,
};

const stripeNoticeDismissStyle: CSSProperties = {
  marginLeft: 'auto',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: OH.c.ink2,
  fontSize: 20,
  lineHeight: 1,
  padding: '0 4px',
};

const connectSummaryListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const connectAlertStyle: CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 12,
  background: 'rgba(178,58,47,0.08)',
  fontFamily: OH.font,
  fontSize: 12,
  color: OH.c.ink,
  lineHeight: '16px',
};

const connectRequirementsStyle: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: OH.c.surfaceAlt,
};
