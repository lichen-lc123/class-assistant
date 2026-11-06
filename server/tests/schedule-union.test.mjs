import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCourse,expandCourse,validateTerm} from '../schedule.mjs';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

const term=validateTerm({academicYear:'2026-2027',name:'秋冬学期',startsOn:'2026-09-14',endsOn:'2027-01-15',config:{aliases:['冬学季'],calendars:[{name:'冬',start_date:'2026-11-09',end_date:'2026-12-31'}],periods:[{number:6,start:'13:25',end:'14:10'},{number:9,start:'16:15',end:'17:00'}]}});
const rule={calendar_name:'冬',season:'冬',weeks:[5,7],weekday:5,period_start:6,period_end:9,room:'工教二301'};
const base={course_name:'工程管理导论',course_code:'00123',teaching_class_code:'000CLASS',teacher:'任课老师',weekly_rules:[rule],schedule_raw:'冬季第5、7周，星期五6—9节',remarks_raw:'12.11、12.25、1.8、1.15'};
const dated=date=>({date,kind:'lecture'});
const expand=(input,t=term)=>expandCourse(normalizeCourse(input,t),t);

test('周次与备注日期取并集，重合课次合并，跨年及未发布后续校历不删日期',()=>{
  const result=expand({...base,special_dates:['2026-12-11','2026-12-25','2027-01-08','2027-01-15','2027-01-22'].map(dated)});
  assert.deepEqual(result.sessions.map(s=>s.date),['2026-12-11','2026-12-25','2027-01-08','2027-01-15','2027-01-22']);
  assert.deepEqual(result.sessions.map(s=>s.lesson_number),[1,2,3,4,5]);
  assert.equal(result.date_reviews.filter(r=>r.action==='merged').length,2);
  assert.equal(result.schedule_status,'ready');assert.equal(result.warnings.length,0);
  assert.ok(result.notices.some(note=>note.includes('2027-01-22')));
  assert.ok(result.sessions.every(s=>s.start_time==='13:25'&&s.end_time==='17:00'&&s.room==='工教二301'));
});

test('只有明确日期且无任何教学周日历时仍可排课，不编造周次',()=>{
  const t={...term,config:{...term.config,calendars:[]}};
  const c=normalizeCourse({...base,weekly_rules:[],special_dates:[{date:'2027-01-22',kind:'lecture',start_time:'13:25',end_time:'17:00',room:'工教二301'}]},t);
  const result=expandCourse(c,t);assert.equal(result.sessions.length,1);assert.deepEqual(c.weekly_rules,[]);assert.equal(result.schedule_status,'ready');
  assert.ok(result.notices.some(note=>note.includes('不依赖教学周')));
  const missing=expand({...base,weekly_rules:[],special_dates:[{date:'2027-01-22',kind:'lecture'}]},t);
  assert.equal(missing.sessions.length,0);assert.equal(missing.date_reviews[0].action,'pending');
});

test('真正同课次冲突采用周次，备注日期与原文完整保留供核对',()=>{
  const input={...base,special_dates:[{date:'2026-12-12',lesson_number:1,kind:'lecture',raw:'原文明示第1次课12月12日'}],extra_fields:{'周次日期冲突处理':[{date:'2026-12-12',lesson_number:1,special_date_index:1,weekly_rule_index:1,week:5,action:'use_weekly_rule',reason:'原文明示同一课次，与第5周星期五矛盾。'}]}};
  const course=normalizeCourse(input,term),result=expandCourse(course,term);
  assert.deepEqual(result.sessions.map(s=>s.date),['2026-12-11','2026-12-25']);
  assert.equal(result.date_reviews[0].action,'weekly_preferred');assert.equal(result.date_reviews[0].weekly_date,'2026-12-11');
  assert.equal(course.special_dates[0].date,'2026-12-12');assert.ok(course.special_dates[0].raw.includes('原文明示'));
  assert.equal(result.schedule_status,'needs_review');assert.ok(result.warnings.some(w=>w.includes('以上课周安排为准')));
});

test('无法唯一定位周次的冲突标记不能删日期，无矛盾的标记不制造冲突',()=>{
  const result=expand({...base,special_dates:[dated('2026-12-12')],extra_fields:{'周次日期冲突处理':[{date:'2026-12-12',action:'use_weekly_rule',reason:'未给出课次依据'}]}});
  assert.ok(result.sessions.some(s=>s.date==='2026-12-12'));assert.ok(result.warnings.some(w=>w.includes('未能唯一对应')));
  const ambiguous=expand({...base,special_dates:[{date:'2026-12-12',kind:'lecture',start_time:'13:25',end_time:'17:00'},{date:'2026-12-12',kind:'lecture',start_time:'18:00',end_time:'20:00'}],extra_fields:{'周次日期冲突处理':[{date:'2026-12-12',lesson_number:1,action:'use_weekly_rule',reason:'未指明对应哪条备注'}]}});
  assert.equal(ambiguous.sessions.filter(s=>s.date==='2026-12-12').length,2);
  const same=expand({...base,special_dates:[dated('2026-12-11')],extra_fields:{'周次日期冲突处理':[{date:'2026-12-11',weekly_rule_index:1,week:5,action:'use_weekly_rule',reason:'待校对的旧标记'}]}});
  assert.equal(same.sessions.length,2);assert.equal(same.date_reviews[0].action,'merged');assert.equal(same.schedule_status,'ready');
});

test('同一天不同时段可为额外授课，不能仅因同日期就删除或认定冲突',()=>{
  const result=expand({...base,special_dates:[{date:'2026-12-11',kind:'lecture',start_time:'18:00',end_time:'20:00',room:'工教二301'}]});
  assert.equal(result.sessions.length,3);assert.equal(result.warnings.length,0);
  assert.equal(result.sessions.filter(s=>s.date==='2026-12-11').length,2);
});

test('实践替换同一时间的课堂，明确日期和具体安排重复也不会恢复普通课堂',()=>{
  const result=expand({...base,special_dates:[{date:'2026-12-11',kind:'practice'}],explicit_sessions:[{date:'2026-12-11',start_time:'13:25',end_time:'17:00',room:'旧教室'}]});
  assert.equal(result.sessions.length,2);const practice=result.sessions.find(s=>s.date==='2026-12-11');assert.equal(practice.kind,'practice');assert.equal(practice.room,null);
});

test('原文明示调课作为例外替换原课次，不误作冲突；补充课次编号保留',()=>{
  const result=expand({...base,special_dates:[{date:'2026-12-12',original_date:'2026-12-11',kind:'reschedule'},{date:'2027-01-08',kind:'supplement',lesson_number:7},{date:'2027-01-15',kind:'supplement',lesson_number:8}]});
  assert.deepEqual(result.sessions.map(s=>s.date),['2026-12-12','2026-12-25','2027-01-08','2027-01-15']);
  assert.equal(result.sessions[2].lesson_number,7);assert.equal(result.sessions[3].lesson_number,8);assert.equal(result.warnings.length,0);
  const adjusted=expand({...base,special_dates:[{date:'2026-12-12',original_date:'2026-12-11',kind:'reschedule'},dated('2026-12-13')],extra_fields:{'周次日期冲突处理':[{date:'2026-12-13',weekly_rule_index:1,week:5,action:'use_weekly_rule',reason:'旧课次对照标记'}]}});
  assert.ok(adjusted.sessions.some(s=>s.date==='2026-12-13'));assert.ok(adjusted.warnings.some(w=>w.includes('已有例外调整')));
});

test('未知活动类型保留明确时间但提示核对，修改后重新计算网站生成的警告',()=>{
  const unknown=expand({...base,special_dates:[{date:'2027-01-08',kind:'unknown'}]});
  assert.equal(unknown.sessions.length,3);assert.ok(unknown.warnings.some(w=>w.includes('类型待确认')));
  const corrected=expand({...normalizeCourse({...base,special_dates:[{date:'2027-01-08',kind:'unknown'}]},term),...unknown,special_dates:[dated('2027-01-08')]});
  assert.equal(corrected.sessions.length,3);assert.ok(!corrected.warnings.some(w=>w.includes('类型待确认')));
  assert.equal(corrected.schedule_status,'ready');
});

test('冲突处理字段和原文星期做校验，信息说明不误标为排课错误',()=>{
  assert.throws(()=>normalizeCourse({...base,extra_fields:{'周次日期冲突处理':'text'}},term),/数组/);
  assert.throws(()=>normalizeCourse({...base,extra_fields:{'周次日期冲突处理':[{date:'bad',action:'use_weekly_rule'}]}},term),/有效日期/);
  const result=expand({...base,extra_fields:{'日期说明':['备注跨年日期按原文保留。']}});
  assert.equal(result.schedule_status,'ready');assert.ok(result.notices.includes('备注跨年日期按原文保留。'));
  assert.throws(()=>normalizeCourse({...base,special_dates:[{date:'2027-01-08',weekday:9}]},term),/星期/);
});

test('AI导入保留未纳入内容、不同时间独立课程和信息不足的疑似重复，预览与保存课次数一致',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'union-admin','学委','UnionAdminFixture123');
  db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('union-student','同学',await hashPassword('UnionStudentFixture123'));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const response=await fetch(baseURL+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:baseURL,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'union-admin',password:'UnionAdminFixture123'})).cookie,student=(await call('/auth/login','POST',{studentId:'union-student',password:'UnionStudentFixture123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',term,admin)).data.id;
  const data={schema_version:'timetable.v1',academic_year:term.academicYear,semester:term.name,courses:[{...base,weekly_rules:[{...rule,weeks:[5]}],special_dates:[dated('2026-12-11')],source_rows:[{source:'学校页面',row:1,raw:'第5周原文'}],remarks_raw:'第一条备注'},{...base,weekly_rules:[{...rule,weeks:[7]}],special_dates:[{date:'2026-12-26',kind:'lecture',raw:'同课次冲突日期原文'}],source_rows:[{source:'学校页面',row:2,raw:'第7周原文'}],remarks_raw:'第二条备注',extra_fields:{'周次日期冲突处理':[{date:'2026-12-26',weekly_rule_index:1,week:7,special_date_index:1,action:'use_weekly_rule',reason:'同一次课明确矛盾'}]}},{course_name:'待通知课程'},{course_name:'待通知课程'}],unparsed_items:[{raw:'原文明示属于春夏学期的课程',reason:'不属于当前目标学期'}],warnings:['请核对未纳入内容']};
  const preview=await call('/timetable/preview','POST',{termId,source:'ai',text:'【课表开始】\n'+JSON.stringify(data)+'\n【课表结束】'},student);
  assert.equal(preview.status,200);assert.equal(preview.data.courses.length,4);assert.equal(preview.data.courses[0].sessions.length,1);
  assert.ok(!preview.data.courses[0].sessions.some(s=>s.date==='2026-12-26'));assert.equal(preview.data.courses[0].source_rows.length,1);
  assert.ok(preview.data.courses[1].remarks_raw.includes('第二条备注'));assert.equal(preview.data.unparsedItems[0].reason,'不属于当前目标学期');
  assert.ok(preview.data.warnings.some(w=>w.includes('疑似重复')));assert.equal(db.prepare('SELECT COUNT(*) n FROM timetables').get().n,0);
  const reviewed=await call('/timetable/preview','POST',{termId,source:'ai',courses:preview.data.courses,unparsedItems:preview.data.unparsedItems,importWarnings:preview.data.importWarnings},student);
  assert.equal(reviewed.status,200);assert.deepEqual(reviewed.data.unparsedItems,preview.data.unparsedItems);
  const saved=await call('/timetable/'+termId,'POST',{source:'ai',courses:reviewed.data.courses,acceptWarnings:true},student);
  assert.equal(saved.status,200);assert.equal(saved.data.courses.length,4);assert.equal(saved.data.added,4);assert.equal(saved.data.skipped,0);
  assert.equal(saved.data.courses.find(c=>c.teaching_class_code==='000CLASS').sessions.length,1);
  const prompt=(await call('/timetable/prompt','GET',undefined,student)).data.text;assert.ok(prompt.includes('并集'));assert.ok(prompt.includes('周次日期冲突处理'));assert.ok(!prompt.includes('网站目标学年：2026-2027'));
});
