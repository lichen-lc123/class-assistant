import {BookOpen, ChevronRight, Clock3, MapPin, UserRound} from 'lucide-react';
import {openCourseHomework} from '../homework/CourseHomeworkDialog';
import {courseTone} from '../homework/types';
import {classroomText} from './CalendarContent';
import {CourseWeekdays} from './CourseWeekdays';
import type {Course} from './types';

export function MyCourses({courses,now,loading,onManage,panelId,labelId}:{courses:Course[];now:number;loading:boolean;onManage?:()=>void;panelId:string;labelId:string}){
  return <section id={panelId} role="tabpanel" aria-labelledby={labelId} className="my-courses-catalog">
    {loading?<p className="empty-state" role="status">正在读取课程…</p>:courses.length?<>
      <p className="course-catalog-count">本学期共 <strong>{courses.length}</strong> 门课程</p>
      <div className="course-catalog-grid">{courses.map(course=>{
        const sessions=[...course.sessions].sort((a,b)=>a.start.localeCompare(b.start));
        const next=sessions.find(s=>Date.parse(s.end)>now),lesson=next||sessions.at(-1);
        return <button type="button" className={`course-catalog-card homework-tone-${courseTone(course.course_name)}`} key={course.id} onClick={()=>openCourseHomework(course.id)} aria-label={`查看课程详情：${course.course_name}`}>
          <span className="course-catalog-title"><strong>{course.course_name}</strong><ChevronRight size={19}/></span>
          <span className="course-catalog-teacher"><UserRound size={14}/>{course.teacher||'老师待确认'}</span>
          <CourseWeekdays sessions={sessions}/>
          {lesson?<><span className="course-catalog-time"><Clock3 size={15}/>{lesson.start_time}—{lesson.end_time}</span><span className="course-catalog-room"><MapPin size={14}/>{classroomText(lesson)}</span></>:<span className="course-catalog-pending">上课时间待安排</span>}
          <span className="course-catalog-footer"><span>{sessions.length?`共 ${sessions.length} 次课 · 已核对`:'待安排'}</span>{next?<span>{Date.parse(next.start)<=now?'正在上课':`下次 ${next.date.slice(5).replace('-','/')}`}</span>:sessions.length?<span>本课程已结束</span>:null}</span>
        </button>;
      })}</div>
    </>:<div className="workspace-card empty-state course-catalog-empty"><BookOpen size={30}/><h2>还没有添加课程</h2><p>添加本学期课程后，可在这里查看课程信息、上课日期和作业。</p>{onManage&&<button type="button" className="primary-button compact" onClick={onManage}>添加课程</button>}</div>}
  </section>;
}
