// Exact alarms that fire while the app is closed and after a reboot, with an optional sound
// (assets/sounds/<name>.mp3) and spoken text. Implemented natively in modules/alarms.
export {
  scheduleAlarm,
  cancelAlarm,
  cancelAllAlarms,
  getScheduledAlarms,
  testAlarm,
  canScheduleExactAlarms,
  openExactAlarmSettings,
  canUseFullScreenAlarms,
  openFullScreenAlarmSettings,
  type AlarmInput,
  type ScheduledAlarm,
} from '../../modules/alarms';

export { ensureNotificationPermission as ensureAlarmPermission } from './notifications';
