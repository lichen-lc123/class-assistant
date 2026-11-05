export function upcomingClassDays(timetables,today){
  const groups=new Map();
  let pendingCourseCount=0,index=0;
  for(const table of timetables){
    for(const course of table.courses){
      const courseIndex=index++;
      if(!course.sessions.length)pendingCourseCount++;
      course.sessions.forEach((s,lessonIndex)=>{
        // A teaching day is a future calendar date, even if today's lesson has not started.
        if(s.date<=today)return;
        if(!groups.has(s.date))groups.set(s.date,[]);
        groups.get(s.date).push({...s,entryId:course.id,courseName:course.course_name,teacher:course.teacher||null,index:courseIndex,lessonNumber:s.lesson_number??lessonIndex+1,termName:table.term.name,academicYear:table.term.academicYear});
      });
    }
  }
  const days=[...groups.keys()].sort().slice(0,3).map(date=>({date,daysUntil:Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000),lessons:groups.get(date).sort((a,b)=>a.start.localeCompare(b.start)||a.courseName.localeCompare(b.courseName))}));
  return{today,timeZone:'Asia/Shanghai',days,pendingCourseCount,timetableCount:timetables.length};
}
