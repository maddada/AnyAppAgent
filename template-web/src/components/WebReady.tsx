import { useState } from 'react';

import { reloadToNewVersion, useNewVersion } from '@/lib/updates';

/**
 * The "Version N is ready" card: shown when a newer version of this app is online. Reload starts
 * it. Keep it at the top of the app's first screen (App.tsx already does). Leave it as it is.
 */
export function WebReady() {
  const next = useNewVersion();
  const [busy, setBusy] = useState(false);
  if (!next) return null;
  return (
    <div className="card notice" role="status">
      <p className="body-strong">Version {next.build} is ready</p>
      {next.changed ? <p className="small muted">{next.changed}</p> : null}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            reloadToNewVersion().catch(() => location.reload());
          }}
        >
          {busy ? 'Reloading' : 'Reload'}
        </button>
      </div>
    </div>
  );
}
