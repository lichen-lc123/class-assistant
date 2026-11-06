import test from 'node:test';
import assert from 'node:assert/strict';
import {cardLessons,replaceCardLessons,dateWeek,dateWeekday,lessonTitle} from '../../src/timetable/card-lessons.ts';
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
test('周次按周一起算，多个校历有歧义时不猜测',()=>{
  assert.equal(dateWeek('2026-09-21',term),2);assert.equal(dateWeekday('2026-09-20'),7);assert.equal(lessonTitle(3),'第三次课');
  assert.equal(dateWeek('2026-09-21',{...term,config:{...term.config,calendars:[{name:'周三起点',start_date:'2026-09-16'}]}}),2);
  assert.equal(dateWeek('2026-09-21',{...term,config:{...term.config,calendars:[...term.config.calendars,{name:'另一日历',start_date:'2026-09-21'}]}}),null);
});
test('服务端拒绝小数课次、无效周次及与日期不一致的星期',()=>{
  const session={date:'2026-09-15',start_time:'08:00',end_time:'10:00'};
  for(const patch of [{lesson_number:1.5},{lesson_number:0},{week:2.5},{weekday:3}])assert.throws(()=>normalizeCourse({...raw,explicit_sessions:[{...session,...patch}]},term));
});
