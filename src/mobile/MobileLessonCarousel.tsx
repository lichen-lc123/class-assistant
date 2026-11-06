import {useEffect,useRef,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Pause,Play} from 'lucide-react';
import type {DashboardDay} from '../timetable/types';
import {SessionTile} from '../timetable/CalendarContent';
import {humanDate} from '../timetable/date';
import {openCourseHomework} from '../homework/CourseHomeworkDialog';

export function MobileLessonCarousel({day,onExhausted}:{day:DashboardDay;onExhausted:()=>void}){
  const [now,setNow]=useState(Date.now()),[selected,setSelected]=useState(''),[playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches),[interacting,setInteracting]=useState(false);
  const touch=useRef<{x:number;y:number}|null>(null),refresh=useRef(onExhausted);refresh.current=onExhausted;
  const lessons=day.lessons.filter(l=>Date.parse(l.end)>now).sort((a,b)=>a.start.localeCompare(b.start));
  const key=(l:typeof lessons[number])=>l.entryId+':'+l.start;
  const ongoing=lessons.find(l=>Date.parse(l.start)<=now),preferred=ongoing||lessons[0];
  const preferredKey=preferred?key(preferred):'',index=Math.max(0,lessons.findIndex(l=>key(l)===selected)),listKey=lessons.map(key).join('|');
  useEffect(()=>{const tick=()=>setNow(Date.now());const timer=window.setInterval(tick,1000);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};},[]);
  const statusKey=preferredKey+(ongoing?':ongoing':':next');
  useEffect(()=>setSelected(preferredKey),[statusKey,day.date]);
  useEffect(()=>{if(!lessons.length)refresh.current();},[listKey]);
  useEffect(()=>{
    if(!playing||ongoing||interacting||lessons.length<2)return;
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setSelected(key(lessons[(index+1)%lessons.length]));},5000);
    return()=>clearInterval(timer);
  },[playing,Boolean(ongoing),interacting,index,listKey]);
  function move(step:number){if(lessons.length){setPlaying(false);setSelected(key(lessons[(index+step+lessons.length)%lessons.length]));}}
  return <section className="phone-lesson-carousel" aria-label="上课安排"><header className="dashboard-column-heading"><div><CalendarDays size={22}/><h2>上课安排</h2></div><span className="phone-lesson-date">{humanDate(day.date)}</span></header>
    {preferred&&selected!==preferredKey&&ongoing&&<button className="text-button" onClick={()=>setSelected(preferredKey)}>回到正在上的课</button>}
    {!lessons.length?<p role="status">正在查找下一个上课日…</p>:<><span className="phone-lesson-status">{Date.parse(lessons[index].start)<=now?'正在上课':index===0?'下一节课':'稍后课程'}{day.daysUntil>0?` · ${day.daysUntil} 天后`:''}</span><div className="class-carousel-window" onFocusCapture={()=>setInteracting(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setInteracting(false);}} onTouchStart={e=>{const p=e.touches[0];touch.current={x:p.clientX,y:p.clientY};setInteracting(true);}} onTouchCancel={()=>{touch.current=null;setInteracting(false);}} onTouchEnd={e=>{const p=e.changedTouches[0],start=touch.current;if(start&&p&&Math.abs(p.clientX-start.x)>40&&Math.abs(p.clientX-start.x)>Math.abs(p.clientY-start.y)*1.3)move(p.clientX<start.x?1:-1);touch.current=null;setInteracting(false);}}><div className="class-carousel-track" style={{transform:`translateX(-${index*100}%)`}}>{lessons.map((lesson,i)=><div className="class-carousel-slide" key={key(lesson)} aria-hidden={i!==index} inert={i!==index}><SessionTile item={lesson} now={now} inlineDetails onCourse={openCourseHomework}/></div>)}</div></div>
      {lessons.length>1&&<footer className="phone-lesson-controls"><button className="icon-button" aria-label="上一节课" onClick={()=>move(-1)}><ChevronLeft size={20}/></button><span>{index+1} / {lessons.length}</span><button className="icon-button" aria-label={playing?'暂停自动切换':'开启自动切换'} disabled={Boolean(ongoing)} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><button className="icon-button" aria-label="下一节课" onClick={()=>move(1)}><ChevronRight size={20}/></button></footer>}</>}
  </section>;
}
