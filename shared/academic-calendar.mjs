export const calendarKindNames = Object.freeze({ class: '非全日制上课', exam: '考试', holiday: '假期', adjustment: '调课说明', preparation: '开学准备', event: '校历事项' });
const DAY = 86400000;
const stamp = date => Date.parse(date + 'T00:00:00Z');
const dateOf = time => new Date(time).toISOString().slice(0, 10);
const valid = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(stamp(date)) && dateOf(stamp(date)) === date;

export function calendarWeekRows(term) {
  const school = term.config?.schoolCalendar;
  const start = school?.display_start || term.startsOn, end = school?.display_end || term.endsOn;
  if (!valid(start) || !valid(end) || end < start || stamp(end) - stamp(start) > 400 * DAY) return [];
  const first = stamp(start) - ((new Date(stamp(start)).getUTCDay() || 7) - 1) * DAY;
  const events = school?.events || [], calendars = term.config?.calendars || [];
  const rows = [];
  for (let monday = first; monday <= stamp(end); monday += 7 * DAY) {
    const sunday = monday + 6 * DAY;
    rows.push({
      start: dateOf(monday), end: dateOf(sunday),
      weeks: calendars.filter(c => valid(c.start_date) && stamp(c.start_date) <= sunday && (!c.end_date || stamp(c.end_date) >= monday)).map(c => {
        const origin = stamp(c.start_date) - ((new Date(stamp(c.start_date)).getUTCDay() || 7) - 1) * DAY;
        return { name: c.name, week: Math.floor((monday - origin) / (7 * DAY)) + 1 };
      }),
      days: Array.from({ length: 7 }, (_, i) => {
        const date = dateOf(monday + i * DAY), outside = date < start || date > end;
        return { date, outside, events: outside ? [] : events.filter(e => e.start_date <= date && (e.end_date || e.start_date) >= date) };
      }),
    });
  }
  return rows;
}

export function academicCalendarWarnings(term) {
  const school = term.config?.schoolCalendar;
  if (!school) return [];
  const warnings = [...(school.warnings || [])];
  if (!term.startsOn || !term.endsOn) warnings.push('学期起止日期未填写，暂不能自动定位当前学期。');
  if (!term.config.calendars?.length) warnings.push('未提取到教学周起点，按周课程暂无法展开。');
  if (!term.config.periods?.length) warnings.push('未提取到节次作息，按节次课程暂无法换算时刻。');
  const outside = (school.events || []).filter(e => school.display_start && e.start_date < school.display_start || school.display_end && (e.end_date || e.start_date) > school.display_end);
  if (outside.length) warnings.push(`${outside.length} 条事项在校历展示范围之外，已保留在事项清单，请核对展示范围。`);
  const overlaps = calendarWeekRows(term).flatMap(w => w.days).filter(d => d.events.some(e => e.kind === 'class') && d.events.some(e => e.kind === 'holiday' || e.kind === 'exam'));
  if (overlaps.length) warnings.push(`有 ${overlaps.length} 天同时标记了非全日制上课与假期或考试（如 ${overlaps.slice(0, 4).map(d => d.date).join('、')}），请核对适用范围；这些事项不会自动取消课程。`);
  return [...new Set(warnings)];
}
