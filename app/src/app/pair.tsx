import { Redirect, useGlobalSearchParams } from "expo-router";

/**
 * Deep links that pair the phone, opened from a link or another app:
 *   anyappagent://pair?url=<encoded http://pc:8787>&code=123456   (same network, the PC's QR)
 *   anyappagent://pair?ec=ANYAPP-EC1:...                           (Easy Connect)
 * The whole link is handed to the Connect screen, which pairs with it and then goes home.
 */
export default function PairLink() {
  const params = useGlobalSearchParams<{ url?: string; code?: string; ec?: string; address?: string }>();
  const link = params.ec
    ? String(params.ec)
    : params.code && String(params.code).toUpperCase().startsWith("ANYAPP-EC1:")
      ? String(params.code)
      : `anyappagent://pair?${new URLSearchParams(
          Object.entries({ url: params.url, address: params.address, code: params.code }).filter(([, v]) => v != null) as [string, string][],
        ).toString()}`;
  return <Redirect href={{ pathname: "/connect", params: { link } }} />;
}
