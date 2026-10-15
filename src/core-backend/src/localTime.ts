/** Weekday, hour and day of a moment in a time zone (the panel's own, for analytics and the weekly digest). */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** weekday (0 = Monday), hour and the day key "YYYY-MM-DD" of a moment in the panel's time zone */
export function localParts(ts: number, tz: string): { dow: number; hour: number; day: string } {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { dow: Math.max(0, dow), hour: Number(p.hour) % 24, day: `${p.year}-${p.month}-${p.day}` };
}

/** the offset of a time zone from UTC at a moment, in ms (+3 h for Moscow) */
export function offsetAt(ts: number, tz: string): number {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(new Date(ts))
        .map((x) => [x.type, Number(x.value)]),
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - Math.floor(ts / 60_000) * 60_000;
  } catch {
    return 0;
  }
}

/** the moment of a local time of a day ("YYYY-MM-DD", minutes after midnight) in a time zone */
export function zonedTime(day: string, minutes: number, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  return naive - offsetAt(naive - offsetAt(naive, tz), tz);
}
