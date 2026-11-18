/**
 * A Material Design icon (https://pictogrammers.com/library/mdi/), drawn in the text colour.
 *
 *   import { mdiAlarm } from '@mdi/js';
 *   <Icon path={mdiAlarm} />            // 24 px
 *   <Icon path={mdiAlarm} size={20} label="Alarm" />
 */
export function Icon({ path, size = 24, label, className }: { path: string; size?: number; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
