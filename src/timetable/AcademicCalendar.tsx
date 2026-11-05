import { academicCalendarWarnings, calendarKindNames, calendarWeekRows } from '../../shared/academic-calendar.mjs';
import type { Term } from './types';

export function AcademicCalendar({term}:{term:Term}) {
  const rows=calendarWeekRows(term),school=term.config.schoolCalendar,warnings=academicCalendarWarnings(term);
  const days=rows.flatMap(r=>r.days).filter(d=>!d.outside);
  return <section className="academic-calendar" aria-label="校历核对表">
    <div className="section-heading"><div><h3>{school?.title||`${term.academicYear} ${term.name}校历`}</h3><p>{school?.institution||'按管理员配置生成'}{school?.source_name&&` · ${school.source_name}`}</p></div></div>
    <div className="calendar-statistics"><span>学期：{term.startsOn||'待补充'} — {term.endsOn||'待补充'}</span><span>非全日制上课 {days.filter(d=>d.events.some(e=>e.kind==='class')).length} 天</span><span>作息 {term.config.periods.length} 节</span><span>事项 {school?.events.length||0} 条</span></div>
    <p className="muted-note">此表用于核对校历。假期、考试和调课备注不会自动取消或移动具体课程；上课标记表示学院上课日，不代表每位同学当天都有课。</p>
    <div className="calendar-legend">{Object.entries(calendarKindNames).map(([kind,label])=><span className={`calendar-mark calendar-${kind}`} key={kind}>{label}</span>)}</div>
    {rows.length>0?<div className="calendar-table-scroll"><table className="academic-calendar-table"><caption>教学周与日期核对表（周一至周日）</caption><thead><tr><th scope="col">教学周</th>{'一二三四五六日'.split('').map(d=><th scope="col" key={d}>星期{d}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.start}><th scope="row"><strong>{row.start} — {row.end}</strong>{row.weeks.map(w=><small key={w.name}>{w.name} · 第 {w.week} 周</small>)}{!row.weeks.length&&<small>非教学周 / 准备阶段</small>}</th>{row.days.map(day=><td className={day.outside?'outside-calendar':''} key={day.date}>{!day.outside&&<><time dateTime={day.date}>{day.date.slice(5).replace('-','/')}</time>{day.events.map((event,i)=><span className={`calendar-mark calendar-${event.kind}`} title={event.description||event.title} key={i}>{event.title}</span>)}</>}</td>)}</tr>)}</tbody></table></div>:<p className="empty-state">填写学期或校历展示起止日期后，自动生成按周核对表。</p>}
    {term.config.calendars.length>0&&<div className="calendar-table-scroll"><table className="calendar-detail-table"><caption>教学周日历</caption><thead><tr><th>名称</th><th>第 1 周起点</th><th>结束日期</th></tr></thead><tbody>{term.config.calendars.map(c=><tr key={c.name}><td>{c.name}</td><td>{c.start_date||'待确认'}</td><td>{c.end_date||'未限定'}</td></tr>)}</tbody></table></div>}
    {term.config.periods.length>0&&<div className="calendar-table-scroll"><table className="calendar-detail-table"><caption>完整上课作息</caption><thead><tr><th>时段</th><th>节次</th><th>开始</th><th>结束</th></tr></thead><tbody>{[...term.config.periods].sort((a,b)=>a.number-b.number).map(p=><tr key={p.number}><td>{p.section||'未分段'}</td><td>第 {p.number} 节</td><td>{p.start}</td><td>{p.end}</td></tr>)}</tbody></table></div>}
    {!!school?.events.length&&<details className="calendar-events-list"><summary>查看全部校历事项与调课原文（{school.events.length} 条）</summary><div className="calendar-table-scroll"><table className="calendar-detail-table"><thead><tr><th>日期</th><th>类型</th><th>事项</th><th>说明 / 适用范围</th></tr></thead><tbody>{[...school.events].sort((a,b)=>a.start_date.localeCompare(b.start_date)).map((e,i)=><tr key={i}><td>{e.start_date}{e.end_date&&e.end_date!==e.start_date&&` — ${e.end_date}`}</td><td>{calendarKindNames[e.kind]}</td><td>{e.title}</td><td>{e.description||'—'}</td></tr>)}</tbody></table></div></details>}
    {!!school?.notes.length&&<div className="calendar-notes"><strong>校历原文备注</strong><ul>{school.notes.map((note,i)=><li key={i}>{note}</li>)}</ul></div>}
    {warnings.length>0&&<div className="review-issues"><strong>需核对的校历信息</strong><ul>{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></div>}
  </section>;
}
