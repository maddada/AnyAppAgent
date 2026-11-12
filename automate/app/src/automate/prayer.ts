// Prayer times for Ajman by the UAE Awqaf method, worked out on the phone (no internet).
// Copied from the person's Prayer Alarm app (its src/lib/prayerTimes.ts, "uae" method), which was
// checked minute for minute against the official Awqaf table for Ajman. Keep the numbers in step.

export const PRAYER_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerKey = (typeof PRAYER_KEYS)[number];

export const PRAYER_LABEL: Record<PrayerKey, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export type DayTimes = Record<PrayerKey, number>;
export type Day = { year: number; month: number; day: number };

const LATITUDE = 25.4052;
const LONGITUDE = 55.42;
/** The UAE is four hours ahead of UTC all year (no summer time). */
export const UTC_OFFSET_MS = 4 * 3600_000;
const UTC_OFFSET_MIN = 240;

const UAE = {
  fajrAngle: 18.18,
  ishaAngle: 18,
  sunriseAngle: 0.89,
  sunsetAngle: 1.15,
  added: { fajr: 0, sunrise: -3, dhuhr: 2, asr: 0, maghrib: 1, isha: 0 },
};

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const tan = (deg: number) => Math.tan(deg * RAD);
const turn = (deg: number) => ((deg % 360) + 360) % 360;

/** Julian day number at 00:00 UTC of a calendar date. */
function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** The sun's declination (degrees) and the equation of time (minutes) at a Julian day. */
function sunPosition(jd: number): { declination: number; equationOfTime: number } {
  const t = (jd - 2451545) / 36525;
  const meanLongitude = turn(280.46646 + t * (36000.76983 + 0.0003032 * t));
  const meanAnomaly = turn(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    sin(3 * meanAnomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const longitude = meanLongitude + centre - 0.00569 - 0.00478 * sin(omega);
  const obliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(longitude)) / RAD;
  const y = tan(obliquity / 2) ** 2;
  const equationOfTime =
    (4 *
      (y * sin(2 * meanLongitude) -
        2 * eccentricity * sin(meanAnomaly) +
        4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude) -
        0.5 * y * y * sin(4 * meanLongitude) -
        1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly))) /
    RAD;
  return { declination, equationOfTime };
}

/** One day's prayer times in Ajman (absolute moments, right whatever the phone's time zone). */
export function prayerTimesFor({ year, month, day }: Day): DayTimes {
  const jd0 = julianDay(year, month, day);
  const sunAt = (minutes: number) => sunPosition(jd0 + (minutes - UTC_OFFSET_MIN) / 1440);
  const noonAt = (minutes: number) => 720 - 4 * LONGITUDE - sunAt(minutes).equationOfTime + UTC_OFFSET_MIN;
  const when = (altitude: number | ((declination: number) => number), side: -1 | 1, guess: number) => {
    let minutes = guess;
    for (let i = 0; i < 4; i++) {
      const sun = sunAt(minutes);
      const target = typeof altitude === 'function' ? altitude(sun.declination) : altitude;
      const cosHour =
        (sin(target) - sin(LATITUDE) * sin(sun.declination)) / (cos(LATITUDE) * cos(sun.declination));
      const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosHour))) / RAD;
      minutes = 720 - 4 * LONGITUDE - sun.equationOfTime + UTC_OFFSET_MIN + side * 4 * hourAngle;
    }
    return minutes;
  };
  let noon = 720;
  for (let i = 0; i < 3; i++) noon = noonAt(noon);
  const minutes = {
    fajr: when(-UAE.fajrAngle, -1, 300),
    sunrise: when(-UAE.sunriseAngle, -1, 360),
    dhuhr: noon,
    asr: when((declination) => Math.atan(1 / (1 + tan(Math.abs(LATITUDE - declination)))) / RAD, 1, 960),
    maghrib: when(-UAE.sunsetAngle, 1, 1080),
    isha: when(-UAE.ishaAngle, 1, 1140),
  };
  const midnight = Date.UTC(year, month - 1, day) - UTC_OFFSET_MS;
  const stamp = (key: PrayerKey) => midnight + (Math.round(minutes[key]) + UAE.added[key]) * 60_000;
  return {
    fajr: stamp('fajr'),
    sunrise: stamp('sunrise'),
    dhuhr: stamp('dhuhr'),
    asr: stamp('asr'),
    maghrib: stamp('maghrib'),
    isha: stamp('isha'),
  };
}

/** The calendar day in Ajman at a moment. */
export function ajmanDay(at: number): Day {
  const d = new Date(at + UTC_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addDays(from: Day, count: number): Day {
  const d = new Date(Date.UTC(from.year, from.month - 1, from.day + count));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "17:32" in Ajman time. */
export function ajmanClock(at: number): string {
  const d = new Date(at + UTC_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
