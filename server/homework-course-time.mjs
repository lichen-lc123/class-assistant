// Only explicit course-time columns constrain recipients. Deadlines never do.
export function homeworkCourseTime(record){
  if(record.course_time?.trim())return record.course_time.trim();
  const values=(record.source_rows||[]).flatMap(row=>Object.values(row.raw||{})).filter(value=>typeof value==='string');
  const columns=(record.source_rows||[]).flatMap(row=>Object.entries(row.raw||{}).filter(([name,value])=>/^(?:上课时间|授课时间|课程时间|上课日期|授课日期)/.test(name.normalize('NFKC').replace(/\s/g,''))&&typeof value==='string'&&value.trim()).map(([,value])=>value.trim()));
  const labeled=[record.notes||'',...values].flatMap(value=>[...value.matchAll(/(?:^|[\n；;，,])\s*(?:上课时间|授课时间|课程时间)\s*[：:]\s*([^\n；;]+)/g)].map(m=>m[1].trim()));
  return [...new Set([...columns,...labeled])].join('；');
}
export function matchesHomeworkCourseTime(value,sessions){
  if(!value)return true;
  const text=value.normalize('NFKC').replace(/：/g,':');
  const dates=[...text.matchAll(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
  const days=[...text.matchAll(/(?:星期|周)([一二三四五六日天1-7])/g)].map(m=>/\d/.test(m[1])?Number(m[1]):m[1]==='天'?7:'一二三四五六日'.indexOf(m[1])+1);
  const times=[...text.matchAll(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g)].map(m=>m[1].padStart(2,'0')+':'+m[2]);
  if(!dates.length&&!days.length&&!times.length)return false;
  if(times.length>1&&times.length%2)return false;
  // Do not invent cross-pairings between dates/weekdays and multiple clock
  // ranges. These more complex instructions require an administrator's review.
  if(times.length>2&&new Set(times.filter((_,i)=>i%2===0).map((time,i)=>time+'-'+times[i*2+1])).size>1)return false;
  if(dates.some(date=>!sessions.some(s=>s.date===date))||days.some(day=>!sessions.some(s=>(new Date(s.date+'T00:00:00Z').getUTCDay()||7)===day)))return false;
  return sessions.some(s=>(!dates.length||dates.includes(s.date))&&(!days.length||days.includes(new Date(s.date+'T00:00:00Z').getUTCDay()||7))&&(!times.length||times.length===1&&s.start_time<=times[0]&&times[0]<s.end_time||times.length>1&&times.some((time,i)=>i%2===0&&time===s.start_time&&times[i+1]===s.end_time)));
}
