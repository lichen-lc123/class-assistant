// Half-open intervals: a lesson ending at 10:00 does not occupy one starting at 10:00.
// Only collisions involving a new lesson block an import; old conflicts do not block unrelated additions.
export function importConflicts(existing,incoming){
  const sessions=[...existing.map(c=>({course:c,isNew:false})),...incoming.map(c=>({course:c,isNew:true}))].flatMap(({course,isNew})=>(course.sessions||[]).map(s=>({name:course.course_name,start:Date.parse(s.start),end:Date.parse(s.end),isNew}))).sort((a,b)=>a.start-b.start);
  const conflicts=[];
  const display=value=>new Date(value+8*3600000).toISOString().slice(0,16).replace('T',' ');
  for(let i=0;i<sessions.length;i++)for(let j=i+1;j<sessions.length&&sessions[j].start<sessions[i].end;j++){
    const a=sessions[i],b=sessions[j];
    if((a.isNew||b.isNew)&&a.start<b.end){
      const start=display(Math.max(a.start,b.start)),end=display(Math.min(a.end,b.end));
      conflicts.push({date:start.slice(0,10),first:a.name,second:b.name,start,end});
      if(conflicts.length>=100)return conflicts;
    }
  }
  return conflicts;
}
export function importConflictMessage(conflicts){
  if(!conflicts.length)return null;
  return '课程时间重复，不能导入。'+conflicts.slice(0,5).map(c=>`${c.start}—${c.end.slice(0,10)===c.date?c.end.slice(11):c.end}，“${c.first}”与“${c.second}”时间重叠。`).join(' ')+(conflicts.length>5?' 另有其他重复时段，请调整后重新导入。':'');
}
