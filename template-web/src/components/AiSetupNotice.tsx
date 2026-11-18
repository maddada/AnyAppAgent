import { aiProblemText, type AiStatus } from '@/lib/ai';
import { closeApp, inKiwimake } from '@/lib/kiwimake';

/**
 * Shown where an AI feature would be when AI cannot be used: in a plain browser ("Open this in
 * Kiwimake to use AI"), no key in Kiwimake yet, or AI switched off for this app. Renders nothing
 * when AI is ready or the status is still loading. Pair it with useAiStatus():
 *
 *   const { status } = useAiStatus();
 *   <AiSetupNotice status={status} />
 */
export function AiSetupNotice({ status, code }: { status?: AiStatus | null; code?: string }) {
  const reason = code ?? (status && !status.ready ? status.reason : null);
  if (!reason) return null;
  const title =
    reason === 'no_kiwimake'
      ? 'AI works inside Kiwimake'
      : reason === 'app_off'
        ? 'AI is off for this app'
        : reason === 'not_set_up'
          ? 'AI is not set up yet'
          : 'AI is not available';
  const canOpen = inKiwimake() && (reason === 'not_set_up' || reason === 'app_off' || reason === 'bad_key');
  return (
    <div className="card notice">
      <p className="body-strong">{title}</p>
      <p className="small muted">{aiProblemText(reason)}</p>
      {canOpen ? (
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => closeApp()}>
            Go to Kiwimake
          </button>
        </div>
      ) : null}
    </div>
  );
}
