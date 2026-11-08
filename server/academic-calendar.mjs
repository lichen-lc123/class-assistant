const error = message => { const e = new Error(message); e.status = 400; throw e; };
const text = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const strings = v => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 100 || v.some(s => typeof s !== 'string' || s.length > 2000)) error('校历备注或待确认事项格式不正确，每项最多 2000 字、最多 100 项。');
  return v.map(s => s.trim()).filter(Boolean);
};
export function normalizeAcademicCalendar(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) error('校历资料格式不正确。');
  const start = raw.display_start || null, end = raw.display_end || null;
  if (Boolean(start) !== Boolean(end) || start && (!date(start) || !date(end) || end < start || Date.parse(end) - Date.parse(start) > 400 * 86400000)) error('校历展示起止日期需同时有效，且范围不超过 400 天。');
  if (raw.events != null && (!Array.isArray(raw.events) || raw.events.length > 500)) error('校历事项最多 500 条。');
  const events = (raw.events || []).map(e => {
    if (!e || typeof e !== 'object' || !text(e.title) || !['class', 'exam', 'holiday', 'adjustment', 'preparation', 'event'].includes(e.kind)) error('请填写校历事项名称及有效类型。');
    if (!date(e.start_date) || e.end_date && (!date(e.end_date) || e.end_date < e.start_date || Date.parse(e.end_date) - Date.parse(e.start_date) > 370 * 86400000)) error('校历事项日期无效，或结束日期早于开始日期。');
    return { title: text(e.title, 120), kind: e.kind, start_date: e.start_date, end_date: e.end_date || null, description: text(e.description, 2000) };
  });
  return { title: text(raw.title, 200), institution: text(raw.institution, 160), source_name: text(raw.source_name, 200), display_start: start, display_end: end, events, notes: strings(raw.notes), warnings: strings(raw.warnings) };
}
export function calendarImport(body, validateTerm) {
  let raw;
  try {
    let content=typeof body.text==='string'?body.text.replace(/^\uFEFF/,'').trim():null;
    if(content?.startsWith('```')){const fenced=content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);if(fenced)content=fenced[1].trim();}
    raw=content!==null?JSON.parse(content):body.data;
  } catch { error('校历结果不是合法 JSON，请复制 AI 返回的完整结果。'); }
  if (!raw || raw.schema_version !== 'academic-calendar.v1') error('请使用网站的校历提示词，格式需为 academic-calendar.v1。');
  if (!raw.school_calendar) error('缺少 school_calendar 校历内容。');
  const term=validateTerm({ academicYear: raw.academic_year, name: raw.semester, startsOn: raw.starts_on, endsOn: raw.ends_on, config: { calendars: raw.calendars, sourceCalendars:raw.source_calendars, periods: raw.periods, aliases: raw.aliases, schoolCalendar: raw.school_calendar } });
  const school=term.config.schoolCalendar;
  school.title ||= `${school.institution||''}${term.academicYear}学年${term.name}教学日历`;
  school.source_name ||= '外部 AI 校历提取结果';
  if(!school.display_start&&!school.display_end&&term.startsOn&&term.endsOn){school.display_start=term.startsOn;school.display_end=term.endsOn;}
  return term;
}
