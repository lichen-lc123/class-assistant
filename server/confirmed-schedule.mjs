// A source-specific correction already confirmed in the timetable import prompt.
// Match the complete original date set and teaching slot; never rewrite edited
// explicit sessions or another teacher's similarly named course.
const confirmedDates=['2026-10-18','2026-11-01','2026-11-15','2026-11-29','2026-12-13','2026-12-27','2027-01-10','2027-01-17'];
export function hasConfirmedCompleteDateList(course) {
  if(course.course_name!=='中国式现代化的理论与实践'||course.teacher!=='彭鹏'||course.explicit_sessions?.length)return false;
  const specials=course.special_dates||[],dates=[...new Set(specials.map(s=>s.date))].sort();
  if(JSON.stringify(dates)!==JSON.stringify(confirmedDates)||specials.length!==8)return false;
  if(!course.remarks_raw?.includes('上课时间：10.18、11.1、11.15、11.29、12.13、12.27、1.10、1.17'))return false;
  if(!course.weekly_rules?.length||!course.weekly_rules.every(r=>r.start_time==='08:50'&&r.end_time==='12:25'))return false;
  return true;
}
