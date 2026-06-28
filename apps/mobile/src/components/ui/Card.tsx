/**
 * Card — the canonical white surface on the cream canvas (DESIGN.md §2.5/§3).
 * Defaults to radius/lg + elev/1 + 16pt padding. Pass `tone` for a pastel/alt
 * fill, `flat` to drop the shadow, or `onPress` to make the whole card tappable.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, shadow } from '@/theme/tokens';

export function Card({
  children,
  tone,
  flat,
  radius = radii.lg,
  padding = 16,
  onPress,
  style,
}: {
  children: ReactNode;
  tone?: string;
  flat?: boolean;
  radius?: number;
  padding?: number;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const base: ViewStyle = { backgroundColor: tone ?? colors.surface, borderRadius: radius, padding };
  const composed = [base, flat ? null : shadow.e1, style];

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...composed, { opacity: pressed ? 0.9 : 1 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={composed}>{children}</View>;
}
