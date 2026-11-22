import { useObserve } from '@mobile-observability/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { markInteractive } = useObserve();
  const [product, setProduct] = useState<{ title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://jsonplaceholder.typicode.com/posts/${id}`)
      .then((response) => response.json() as Promise<{ title: string }>)
      .catch(() => ({ title: `Product ${id}` }))
      .then((data) => {
        if (cancelled) return;
        setProduct(data);
        markInteractive({ params: { productId: Number(id) } });
      });
    return () => {
      cancelled = true;
    };
  }, [id, markInteractive]);

  if (!product) return <ActivityIndicator style={styles.loading} />;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{product.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
});
