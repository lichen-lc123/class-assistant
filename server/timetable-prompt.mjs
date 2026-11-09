import {primaryTeachingCalendar} from '../shared/course-week.mjs';

export function buildTimetablePrompt(text,term){
 const config=term.config||{},periods=config.periods||[];
 const ranges=[[2,5],[6,9],[11,14]].flatMap(([first,last])=>{
  const start=periods.find(p=>p.number===first)?.start,end=periods.find(p=>p.number===last)?.end;
  return start&&end?[`${first}—${last}节 = ${start}—${end}`]:[];
 });
 const context={academic_year:term.academicYear,semester:term.name,primary_calendar:primaryTeachingCalendar(term),calendars:config.calendars||[],source_calendars:config.sourceCalendars||[],periods};
 return `你是课表数据整理助手。先读取以下网站排课依据，再按后面的协议整理用户原文。配置不是选课记录，不能凭配置增加课程。

【网站当前学期与作息——已由网站提供，请勿忽略】
网站目标学年：${term.academicYear}
网站目标学期：${term.name}
${periods.length?`网站已提供 ${periods.length} 个节次的起止时分；先查下面的 periods，再判断某一所需节次是否缺失。`:'网站尚未配置节次作息；没有原文明示的时分时保留待安排，不猜测。'}
${ranges.length?'按本次实际配置换算的常见节次区间（仅用于原文明示的对应节次，不代表学生已选课程）：\n'+ranges.join('\n')+'\n':''}完整配置：
${JSON.stringify(context)}
【网站排课依据结束】

读原文时，周次、星期、节次和教室都要分别填写到正式字段，不能只把整段文字放到 raw。已明确的实践活动 kind 必须为 practice。页头姓名、学号、学分统计和导航不是课程，不得放入 unparsed_items。

${text}`;
}
