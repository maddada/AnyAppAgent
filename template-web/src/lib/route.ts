// Screens by hash route (#/history). The app is served from one address only, so never use path
// routes (/history) or a router that needs them.
import { useCallback, useEffect, useState } from 'react';

function current(): string {
  const h = location.hash.replace(/^#\/?/, '');
  return h ? `/${h}` : '/';
}

/**
 * The current route ("/", "/history", "/item/42") and a way to go somewhere.
 *
 *   const [route, go] = useRoute();
 *   if (route === '/history') return <History onBack={() => go('/')} />;
 */
export function useRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((to: string) => {
    location.hash = to === '/' ? '' : `#${to.startsWith('/') ? to : `/${to}`}`;
  }, []);
  return [route, go];
}
