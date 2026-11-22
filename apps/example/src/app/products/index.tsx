import { ObserveInteractiveMarker } from '@mobile-observability/react-native';
import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';

const PRODUCTS = Array.from({ length: 20 }, (_, index) => ({
  id: String(index + 1),
  name: `Product ${index + 1}`,
}));

export default function Products() {
  return (
    <>
      <FlatList
        data={PRODUCTS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/products/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row} accessibilityRole="link">
              <Text style={styles.name}>{item.name}</Text>
            </Pressable>
          </Link>
        )}
      />
      <ObserveInteractiveMarker params={{ productCount: PRODUCTS.length }} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#CBD5E1' },
  name: { fontSize: 16 },
});
