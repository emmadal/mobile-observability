import { Pressable, StyleSheet, Text } from 'react-native';

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  testID?: string;
}

export function ActionButton({ label, onPress, tone = 'default', testID }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'danger' && styles.danger,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, tone === 'danger' && styles.dangerLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  danger: { backgroundColor: '#FEE2E2' },
  pressed: { opacity: 0.6 },
  label: { fontSize: 16, color: '#0F172A', fontWeight: '500' },
  dangerLabel: { color: '#991B1B' },
});
