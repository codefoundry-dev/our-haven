/**
 * StatePicker — labelled trigger that opens a searchable modal list of the 50
 * states + DC (OH-183). Built from RN primitives (Modal + FlatList) so it
 * renders identically on web and native. The resident state drives per-state
 * adapter routing (ADR-0009/0015).
 */
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { STATE_OPTIONS, stateLabel, type StateCode } from '@/lib/supply';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface StatePickerProps {
  value: StateCode | null;
  onChange: (next: StateCode) => void;
  label?: string;
}

export function StatePicker({ value, onChange, label = 'Resident state' }: StatePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STATE_OPTIONS;
    return STATE_OPTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q));
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `Resident state: ${stateLabel(value)}` : 'Select your state'}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <Text style={[styles.triggerText, !value && styles.placeholder]}>
          {value ? stateLabel(value) : 'Select your state'}
        </Text>
        <Icon name="chevron-down" size={18} color={colors.ink2} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Your state</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
                <Icon name="x" size={20} color={colors.ink} />
              </Pressable>
            </View>
            <View style={styles.searchBox}>
              <Icon name="search" size={18} color={colors.ink3} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search states"
                placeholderTextColor={colors.ink3}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Text style={[styles.rowText, active && styles.rowTextActive]}>{item.label}</Text>
                    {active ? <Icon name="check" size={18} color={colors.brand} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>No states match “{query.trim()}”.</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  trigger: {
    marginTop: 6,
    minHeight: 52,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerPressed: { borderColor: colors.ink },
  triggerText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, paddingVertical: 14 },
  placeholder: { color: colors.ink3 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(22,21,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 18,
    ...shadow.e3,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  rowTextActive: { fontFamily: fonts.semibold, color: colors.brand },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink3, paddingVertical: 20, textAlign: 'center' },
});
