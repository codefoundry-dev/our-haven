/** Notice — inline info/warn/error banner (design: the surfaceAlt info rows). */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

type Tone = 'neutral' | 'warn' | 'error';

const TONES: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.ink2, icon: 'info' },
  warn: { bg: 'rgba(201,122,42,0.12)', fg: colors.warning, icon: 'info' },
  error: { bg: 'rgba(178,58,47,0.10)', fg: colors.danger, icon: 'info' },
};

export function Notice({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: Tone; icon?: IconName }) {
  const t = TONES[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Icon name={icon ?? t.icon} size={18} color={t.fg} />
      <Text style={[styles.text, { color: tone === 'neutral' ? colors.ink2 : t.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: radii.md },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
});
