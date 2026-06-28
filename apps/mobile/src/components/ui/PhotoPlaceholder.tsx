/**
 * PhotoPlaceholder — cream-toned imagery stand-ins for the scaffold
 * (design: primitives.jsx Photo / PortraitPlaceholder). Real photography is
 * wired later; these keep the layout honest. `Portrait` adds a head+shoulders
 * silhouette for Provider cards.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';

import { colors, fonts, radii } from '@/theme/tokens';

export function PhotoPlaceholder({
  height = 200,
  label = 'photo',
  tint = colors.surfaceAlt,
  radius = radii.lg,
  style,
}: {
  height?: number;
  label?: string;
  tint?: string;
  radius?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.box, { height, backgroundColor: tint, borderRadius: radius }, style]}>
      {label ? <Text style={styles.caption}>{label}</Text> : null}
    </View>
  );
}

export function Portrait({
  height = 220,
  tint = colors.surfaceAlt,
  label = 'provider photo',
  radius = 0,
  style,
}: {
  height?: number;
  tint?: string;
  label?: string;
  radius?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.portrait, { height, backgroundColor: tint, borderRadius: radius }, style]}>
      <Svg viewBox="0 0 200 220" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
        <Ellipse cx="100" cy="95" rx="36" ry="42" fill="rgba(22,21,19,0.16)" />
        <Path d="M30 220 C 30 160, 60 140, 100 140 C 140 140, 170 160, 170 220 Z" fill="rgba(22,21,19,0.16)" />
      </Svg>
      {label ? <Text style={styles.portraitCaption}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  caption: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  portrait: { width: '100%', overflow: 'hidden' },
  portraitCaption: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: 'rgba(22,21,19,0.45)',
  },
});
