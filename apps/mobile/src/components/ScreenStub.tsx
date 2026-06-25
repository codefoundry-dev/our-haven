/**
 * ScreenStub — placeholder body for a role-shell tab. The navigation shell is
 * real (OH-176); the per-tab feeds are downstream M2 tickets.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/Screen';
import { colors, fonts, radii } from '@/theme/tokens';

interface ScreenStubProps {
  title: string;
  icon: IconName;
  subtitle: string;
  children?: ReactNode;
}

export function ScreenStub({ title, icon, subtitle, children }: ScreenStubProps) {
  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <View style={styles.appBar}>
        <Text style={styles.heading}>{title}</Text>
        <IconButton name="bell" badge />
      </View>
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Icon name={icon} size={28} color={colors.brand} />
        </View>
        <Text style={styles.stubTitle}>Coming soon</Text>
        <Text style={styles.stubSub}>{subtitle}</Text>
        {children}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  heading: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 120 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stubTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  stubSub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
});
