import {primaryTeachingCalendar} from '../shared/course-week.mjs';

export function buildTimetablePrompt(text,term){
 const config=term.config||{},periods=config.periods||[];
 const ranges=[[2,5],[6,9],[11,14]].flatMap(([first,last])=>{
  const start=periods.find(p=>p.number===first)?.start,end=periods.find(p=>p.number===last)?.end;
  return start&&end?[`${first}—${last}节 = ${start}—${end}`]:[];
 });
 const context={academic_year:term.academicYear,semester:term.name,explicit_date_policy:{retain_outside_calendar:true,calendar_bounds_are_not_date_filters:true,keep_in_original_course:true},primary_calendar:primaryTeachingCalendar(term),calendars:config.calendars||[],source_calendars:config.sourceCalendars||[],periods};
 return `你是课表数据整理助手。先读取以下网站排课依据，再按后面的协议整理用户原文。配置不是选课记录，不能凭配置增加课程。

【最高优先级：原文明示的上课日期必须保留】
课程归属与实际上课日期是两件事。已识别属于当前目标学期的课程，其明确日期即使超出秋冬等原表标签、学期起止日期或任何校历 start_date/end_date，仍保留在原课程中；不能删除、移到另一学期、修改年份，或要求先提供后续校历。
下面配置中的 start_date/end_date 是教学周参考范围，不是明确上课日期的筛选条件。超范围本身不构成冲突或错误，不得因此放入 unparsed_items，也不得仅留在 raw 或 extra_fields 而遗漏正式日期条目。
日期与起止时分已确定的，写入 explicit_sessions；日期明确但时间尚不能确定的，写入 special_dates 并保留 date，只提示真正缺失的时间。无论哪一种情况，都不能把已确定的日期改成 null。
只写月日时结合目标学年和课程上下文补全年份，跨到次年不等于属于其他课程学年；只因日期超出校历范围，不能生成“周次日期冲突处理”。同一课次仍去重，已经有证据确认的真实调课或同课次冲突按正文规则处理。

【网站当前学期与作息——已由网站提供，请勿忽略】
网站目标学年：${term.academicYear}
网站目标学期：${term.name}
${periods.length?`网站已提供 ${periods.length} 个节次的起止时分；先查下面的 periods，再判断某一所需节次是否缺失。`:'网站尚未配置节次作息；没有原文明示的时分时保留待安排，不猜测。'}
${ranges.length?'按本次实际配置换算的常见节次区间（仅用于原文明示的对应节次，不代表学生已选课程）：\n'+ranges.join('\n')+'\n':''}完整配置：
${JSON.stringify(context)}
【网站排课依据结束】

读原文时，周次、星期、节次和教室都要分别填写到正式字段，不能只把整段文字放到 raw。已明确的实践活动 kind 必须为 practice。页头姓名、学号、学分统计和导航不是课程，不得放入 unparsed_items。输出前逐个核对原文明示日期，确认均在 explicit_sessions 或 special_dates 中有对应条目；教学周可参考日历，明确日期不能被日历边界过滤。explicit_date_policy 是网站提供的处理规则，不是要求增加同名输出字段。

${text}`;
}
