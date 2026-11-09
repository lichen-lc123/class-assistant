import test from 'node:test';
import assert from 'node:assert/strict';
import {cardLessons,replaceCardLessons,dateWeek,dateWeekday,lessonTitle,newCardLesson,numberCardLessons} from '../../src/timetable/card-lessons.ts';
import {normalizeCourse,expandCourse} from '../schedule.mjs';

const term={academicYear:'2026-2027',name:'第一学期',config:{calendars:[{name:'教学周',start_date:'2026-09-14',end_date:'2027-01-31'}],periods:[]}};
const raw={course_name:'课程',teacher:'老师',room:'原教室',weekly_rules:[{calendar_name:'教学周',weeks:[1,2],weekday:1,start_time:'08:00',end_time:'10:00'}]};
function expanded(value){const c=normalizeCourse(value,term);return {...c,...expandCourse(c,term)};}
test('逐次编辑周次课程不会重复生成旧日期，保留教室与课次',()=>{
  const c=expanded(raw),lessons=cardLessons(c,term);
  assert.equal(lessons.length,2);assert.equal(lessons[0].room,'原教室');
  lessons[0]={...lessons[0],date:'2026-09-15',room:'新教室',week:1};
  const saved=expanded(replaceCardLessons(c,lessons.slice(0,1),term));
  assert.equal(saved.sessions.length,1);assert.equal(saved.sessions[0].date,'2026-09-15');
  assert.equal(saved.sessions[0].room,'新教室');assert.equal(saved.sessions[0].lesson_number,1);
  assert.equal(cardLessons(saved,term)[0].week,1);assert.equal(saved.explicit_sessions[0].weekday,2);
});
test('待确认规则、超出校历的周次和待确认备注仍保留',()=>{
  const c=expanded({...raw,weekly_rules:[...raw.weekly_rules,{weeks:[2],weekday:1,calendar_name:'未知'}, {...raw.weekly_rules[0],weeks:[1,30]}],special_dates:[{date:null,kind:'unknown',raw:'待通知'}]});
  const changed=replaceCardLessons(c,cardLessons(c,term),term);
  assert.equal(changed.weekly_rules.length,2);assert.deepEqual(changed.weekly_rules[1].weeks,[30]);assert.equal(changed.special_dates.length,1);
});
test('周次按周一起算，旧分段校历不改变完整学期连续周次',()=>{
  assert.equal(dateWeek('2026-09-21',term),2);assert.equal(dateWeekday('2026-09-20'),7);assert.equal(lessonTitle(3),'第三次课');
  assert.equal(dateWeek('2026-09-21',{...term,config:{...term.config,calendars:[{name:'周三起点',start_date:'2026-09-16'}]}}),2);
  assert.equal(dateWeek('2026-09-21',{...term,config:{...term.config,calendars:[...term.config.calendars,{name:'另一日历',start_date:'2026-09-21'}]}}),2);
});
test('服务端拒绝小数课次、无效周次及与日期不一致的星期',()=>{
  const session={date:'2026-09-15',start_time:'08:00',end_time:'10:00'};
  for(const patch of [{lesson_number:1.5},{lesson_number:0},{week:2.5},{weekday:3}])assert.throws(()=>normalizeCourse({...raw,explicit_sessions:[{...session,...patch}]},term));
});

test('新增课堂沿用第一节课地点及时间，日期和校历信息不沿用',()=>{
  const first={date:'2026-09-15',start_time:'08:50',end_time:'12:25',room:'教室甲',week:1,weekday:2,lesson_number:1};
  const later={...first,room:'教室乙',start_time:'13:00',lesson_number:2};
  const added=newCardLesson([first,later]);
  assert.equal(added.lesson_number,3);assert.equal(added.room,'教室甲');assert.equal(added.start_time,'08:50');assert.equal(added.end_time,'12:25');
  assert.equal(added.date,'');assert.equal(added.week,null);assert.equal(added.weekday,null);
  added.room='独立地点';assert.equal(first.room,'教室甲');
  assert.equal(newCardLesson([]).start_time,'');assert.equal(newCardLesson([]).lesson_number,1);
});

test('删除中间课次后连续自动编号，保持日期和各节课的独立设置',()=>{
  const original=[1,3,8].map(n=>({key:n,lesson_number:n,date:'2026-09-'+String(14+n),start_time:'08:00',end_time:'10:00',room:'教室'+n}));
  const numbered=numberCardLessons(original);
  assert.deepEqual(numbered.map(s=>s.lesson_number),[1,2,3]);assert.deepEqual(original.map(s=>s.lesson_number),[1,3,8]);
  const remaining=numberCardLessons(numbered.filter(s=>s.key!==3));
  assert.deepEqual(remaining.map(s=>s.lesson_number),[1,2]);assert.equal(remaining[1].room,'教室8');assert.equal(newCardLesson(remaining).lesson_number,3);
});

test('插入一月之前的课次后自动顺延，改期、同日不同时刻和删除使用相同顺序',()=>{
  const original=['2026-10-03','2026-10-17','2026-10-31','2026-11-14','2026-11-28','2026-12-12','2027-01-09','2027-01-16'].map((date,index)=>({key:index,lesson_number:index+1,date,start_time:'08:50',end_time:'12:25',room:'教室'+index}));
  const inserted=numberCardLessons([...original,{...original[6],key:8,date:'2026-12-26',lesson_number:9}]);
  assert.equal(inserted[6].key,8);assert.equal(inserted[6].lesson_number,7);assert.equal(inserted[7].key,6);assert.equal(inserted[7].lesson_number,8);assert.equal(original[6].lesson_number,7);
  const changed=numberCardLessons(inserted.map(s=>s.key===8?{...s,date:'2027-01-09',start_time:'13:25',end_time:'17:00'}:s));
  assert.equal(changed[6].key,6);assert.equal(changed[6].lesson_number,7);assert.equal(changed[7].key,8);assert.equal(changed[7].lesson_number,8);
  const removed=numberCardLessons(changed.filter(s=>s.key!==8));assert.deepEqual(removed.map(s=>s.lesson_number),[1,2,3,4,5,6,7,8]);
  const pending=numberCardLessons([{...original[0],date:'',key:9},...original]);assert.equal(pending.at(-1).key,9);
  const saved=expanded(replaceCardLessons(expanded({...raw,weekly_rules:[],explicit_sessions:original}),inserted,term));
  assert.deepEqual(saved.sessions.map(s=>s.lesson_number),[1,2,3,4,5,6,7,8,9]);assert.equal(saved.sessions[6].date,'2026-12-26');
});

test('无效日期及校历范围外日期不编造周次',()=>{
  assert.equal(dateWeekday('2026-02-30'),null);assert.equal(dateWeekday('not-a-date'),null);
  assert.equal(dateWeek('2026-02-30',term),null);assert.equal(dateWeek('2026-09-13',term),null);
  assert.equal(dateWeek('2027-02-01',term),null);assert.equal(dateWeek('2026-09-20',term),1);
});
