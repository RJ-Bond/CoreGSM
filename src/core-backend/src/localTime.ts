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
