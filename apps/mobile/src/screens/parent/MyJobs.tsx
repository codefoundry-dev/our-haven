/**
 * My Jobs hub (Parent) — OH-210; PRD stories 88, 92. The Parent's posted Jobs
 * bucketed into Open / Awarded / Past / Drafts. Tapping a Job opens its detail +
 * applicant review (job-applicants). "Post a Job" opens the composer.
 *
 * Native + narrow web (the wide-web two-pane hub is screens/web/parent/Jobs).
 */
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { AvatarGroup } from '@/components/ui/Avatar';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import type { MyJob } from '@/api/client';
import { categoryChip, jobBucket, jobScheduleLabel, jobStatusStyle, useMyJobs, type JobBucket } from '@/lib/jobsHub';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const APP_TONES: ColorToken[] = ['catTutor', 'catBaby', 'catNanny'];

const SECTIONS: { bucket: JobBucket; title: string }[] = [
  { bucket: 'open', title: 'Open' },
  { bucket: 'awarded', title: 'Awarded' },
  { bucket: 'past', title: 'Past' },
  { bucket: 'drafts', title: 'Drafts' },
];

export default function MyJobsScreen() {
  const router = useRouter();
  const { jobs, loading, error, refetch } = useMyJobs();

  const openJob = (jobId: string) => router.push({ pathname: '/job-applicants', params: { jobId } });

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="My Jobs" onBack={() => router.back()} />

      <PrimaryButton
        onPress={() => router.push('/post-job')}
        icon={<Icon name="briefcase" size={18} color={colors.inkInv} />}
        style={styles.postBtn}
      >
        Post a Job
      </PrimaryButton>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={refetch} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : jobs.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No Jobs yet</Text>
          <Text style={styles.emptySub}>
            Post a Job to describe what you need — verified Caregivers apply to you.
          </Text>
        </View>
      ) : (
        SECTIONS.map(({ bucket, title }) => {
          const inBucket = jobs.filter((j) => jobBucket(j.state) === bucket);
          if (inBucket.length === 0) return null;
          return (
            <View key={bucket} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {title} · {inBucket.length}
              </Text>
              <View style={styles.list}>
                {inBucket.map((job) => (
                  <JobCard key={job.id} job={job} onPress={() => openJob(job.id)} />
                ))}
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
}

function JobCard({ job, onPress }: { job: MyJob; onPress: () => void }) {
  const status = jobStatusStyle(job.state);
  const showApplicants = job.state === 'open';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.95 : 1 }]}
    >
      <View style={styles.cardTop}>
        <CategoryChip category={categoryChip(job.category)} />
        <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.fg }]}>
            {status.label}
            {showApplicants ? ` · ${job.applicationCount}/15` : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {job.description}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {jobScheduleLabel(job)}
      </Text>
      <View style={styles.cardBottom}>
        {showApplicants && job.applicationCount > 0 ? (
          <AvatarGroup
            items={Array.from({ length: Math.min(job.applicationCount, 4) }, (_, k) => ({
              tone: APP_TONES[k % APP_TONES.length],
            }))}
          />
        ) : (
          <Text style={styles.cardCat}>{categoryChip(job.category)}</Text>
        )}
        <Icon name="chevron-right" size={18} color={colors.ink3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  postBtn: { marginTop: 8, marginBottom: 8 },

  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24, gap: 10 },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center' },

  section: { marginTop: 22 },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginBottom: 12,
  },
  list: { gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 16, gap: 10, ...shadow.e1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  cardMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cardCat: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
});
