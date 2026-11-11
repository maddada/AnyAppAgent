import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { aiProblemText, openAiSetup, type AiStatus } from '@/lib/ai';
import { type, useColors } from '@/theme';

/**
 * Shown where an AI feature would be when AI cannot be used yet (no key in AnyAppAgent, or AI
 * switched off for this app). Its button opens AnyAppAgent's settings. Renders nothing when AI is
 * ready or the status is still loading. Pair it with useAiStatus():
 *
 *   const { status } = useAiStatus();
 *   <AiSetupNotice status={status} />
 */
export function AiSetupNotice({ status, code }: { status?: AiStatus | null; code?: string }) {
  const colors = useColors();
  const reason = code ?? (status && !status.ready ? status.reason : null);
  if (!reason) return null;
  const canOpen = reason !== 'no_anyappagent' && reason !== 'not_allowed';
  const title =
    reason === 'app_off' ? 'AI is off for this app' : reason === 'not_set_up' ? 'AI is not set up yet' : 'AI is not available';
  return (
    <Card>
      <Text style={[type.bodyStrong, { color: colors.text }]}>{title}</Text>
      <Text style={[type.small, styles.line, { color: colors.textMuted }]}>{aiProblemText(reason)}</Text>
      {canOpen ? <Button title="Open AnyAppAgent" variant="secondary" onPress={() => openAiSetup()} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { marginBottom: 4 },
});
