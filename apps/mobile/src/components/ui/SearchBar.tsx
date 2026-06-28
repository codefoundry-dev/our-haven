/**
 * SearchBar — pill search input (DESIGN.md §3.5). Leading search glyph, optional
 * trailing filter icon button. Read-only `onPress` mode lets it act as a button
 * that opens the search screen.
 */
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onPress,
  onFilter,
  style,
}: {
  value?: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  onPress?: () => void;
  onFilter?: () => void;
  style?: ViewStyle;
}) {
  const inner = (
    <>
      <Icon name="search" size={20} color={colors.ink3} />
      {onPress ? (
        <Text style={[styles.input, styles.placeholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          style={styles.input}
        />
      )}
      {onFilter ? (
        <Pressable onPress={onFilter} hitSlop={8} accessibilityLabel="Filters" style={styles.filterBtn}>
          <Icon name="sliders" size={18} color={colors.ink} />
        </Pressable>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="search" style={[styles.bar, style]}>
        {inner}
      </Pressable>
    );
  }
  return <View style={[styles.bar, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, padding: 0 },
  placeholder: { color: colors.ink3 },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
