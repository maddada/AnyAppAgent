// Catches an error while drawing a screen: instead of a blank screen the person sees a calm
// "Something went wrong" with Try again, and AnyAppAgent offers to fix it (src/lib/crash.ts).
// App.tsx wraps the whole app in it: leave it there.
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { reportError } from '@/lib/crash';
import { spacing, type, useColors } from '@/theme';

function Fallback({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <Text style={[type.title, { color: colors.text }]}>Something went wrong</Text>
      <Text style={[type.body, { color: colors.textMuted }]}>
        This part of the app ran into a problem. It was sent to AnyAppAgent, which can fix it.
      </Text>
      <Button title="Try again" onPress={onRetry} />
    </View>
  );
}

export class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error);
  }

  render() {
    if (this.state.failed) return <Fallback onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
});
