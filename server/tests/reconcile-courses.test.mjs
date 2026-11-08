import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../database.mjs';
import {reconcileCourses} from '../reconcile-courses.mjs';
import {timetableService} from '../timetable.mjs';
import {normalizeCourse,expandCourse} from '../schedule.mjs';

const legacy={calendars:[{name:'旧全学期',start_date:'2026-09-14',end_date:'2027-01-15'},{name:'旧后半学期',start_date:'2026-11-09',end_date:'2027-01-15'}],periods:[],aliases:[]};
const course={course_name:'测试课程',teacher:'测试老师',explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室甲',week:1}]};
function fixture(){
 const db=openDatabase(':memory:');
 db.exec("INSERT INTO users(id,student_id,name,password_hash) VALUES(1,'fixture','测试同学','not-a-real-password');INSERT INTO sessions VALUES('fixture-session',1,9999999999999)");
 db.prepare('INSERT INTO terms(id,academic_year,name,starts_on,ends_on,config_json) VALUES(?,?,?,?,?,?)').run('term','2026-2027','第一学期','2026-09-14','2027-01-15',JSON.stringify(legacy));
 for(const [id,origin] of [['manual','manual'],['generated','template']])db.prepare('INSERT INTO public_courses(id,term_id,payload_json,origin) VALUES(?,?,?,?)').run(id,'term',JSON.stringify(course),origin);
 db.exec("INSERT INTO timetable_templates(id,term_id,name) VALUES('template','term','模板');INSERT INTO template_courses(template_id,course_id) VALUES('template','generated');INSERT INTO timetables(id,user_id,term_id,source) VALUES('table',1,'term','cards');INSERT INTO timetable_template_subscriptions VALUES('table','template',1)");
 for(const [id,card,direct] of [['one','manual','cards'],['two','generated',null]])db.prepare('INSERT INTO timetable_entries(id,timetable_id,course_id,direct_source) VALUES(?,?,?,?)').run(id,'table',card,direct);
 db.exec("INSERT INTO timetable_entry_templates VALUES('two','template')");
 db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,owner_id) VALUES(?,?,?,?,?,?,?,?)').run('work','term','fixture','assignment','作业',JSON.stringify({course_entry_id:'two',content:'原内容'}),1,1);
 db.exec("INSERT INTO homework_completions(user_id,record_id,completed_revision) VALUES(1,'work',1);INSERT INTO homework_preferences(user_id,record_id,priority,planned_date,planned_time) VALUES(1,'work','high','2026-11-10','20:00');INSERT INTO homework_reads VALUES(1,'work',1);INSERT INTO homework_targets(record_id,target_key,course_id) VALUES('work','course:generated','generated')");
 return db;
}
const counts=db=>Object.fromEntries(['public_courses','timetable_entries','template_courses','users','sessions','homework_records','homework_completions','homework_preferences','homework_reads'].map(table=>[table,db.prepare('SELECT count(*) n FROM '+table).get().n]));
test('历史模板和手动卡片去重：预演不落库，保留来源、作业、个人状态，重复运行不再改动',()=>{
 const db=fixture(),before=counts(db),preferences=db.prepare('SELECT * FROM homework_preferences').get();
 const dry=reconcileCourses(db);assert.equal(dry.cardsMerged,1);assert.equal(dry.entriesMerged,1);assert.deepEqual(counts(db),before);assert.equal(db.prepare('SELECT course_id FROM template_courses').get().course_id,'generated');
 const result=reconcileCourses(db,{apply:true});assert.equal(result.cardsMerged,1);assert.equal(result.entriesMerged,1);
 assert.equal(db.prepare('SELECT origin FROM public_courses').get().origin,'manual');assert.equal(db.prepare('SELECT course_id FROM template_courses').get().course_id,'manual');assert.ok(db.prepare('SELECT course_snapshot_json FROM template_courses').get().course_snapshot_json);
 const entry=db.prepare('SELECT * FROM timetable_entries').get();assert.equal(entry.direct_source,'cards');assert.equal(entry.course_id,'manual');assert.ok(db.prepare('SELECT * FROM timetable_entry_templates WHERE entry_id=?').get(entry.id));
 assert.equal(JSON.parse(db.prepare('SELECT payload_json FROM homework_records').get().payload_json).course_entry_id,entry.id);
 assert.equal(db.prepare('SELECT course_id FROM homework_targets').get().course_id,'manual');assert.deepEqual(db.prepare('SELECT * FROM homework_preferences').get(),preferences);assert.equal(db.prepare('SELECT completed_revision FROM homework_completions').get().completed_revision,1);
 const second=reconcileCourses(db,{apply:true});for(const key of ['termsUpdated','payloadsUpdated','confirmedSchedulesFixed','cardsMerged','entriesMerged','targetsUpdated'])assert.equal(second[key],0,key);
 assert.equal(timetableService(db).get(1,'term').courses.length,1);db.close();
});
test('不同老师、不同时间不合并；个人教室或时间冲突不覆盖',()=>{
 const db=fixture();
 db.prepare('INSERT INTO public_courses(id,term_id,payload_json,origin) VALUES(?,?,?,?)').run('different','term',JSON.stringify({...course,teacher:'另一老师'}),'manual');
 const override=JSON.stringify({room_overrides:{0:'个人教室'},time_override:null,base_session_count:1});db.prepare('UPDATE timetable_entries SET override_json=? WHERE id=?').run(override,'two');
 const result=reconcileCourses(db,{apply:true});assert.equal(result.cardsMerged,1);assert.equal(result.entriesMerged,0);assert.ok(result.skippedConflicts);assert.equal(db.prepare('SELECT override_json FROM timetable_entries WHERE id=?').get('two').override_json,override);assert.equal(counts(db).public_courses,2);db.close();
});
test('仅修复已确认原始8次课，保留1月10日和17日，不生成1月8日或其他周次课堂',()=>{
 const db=fixture(),dates=['2026-10-18','2026-11-01','2026-11-15','2026-11-29','2026-12-13','2026-12-27','2027-01-10','2027-01-17'];
 const raw={course_name:'中国式现代化的理论与实践',teacher:'彭鹏',weekly_rules:[{calendar_name:'旧全学期',weeks:[4],weekday:2,start_time:'08:50',end_time:'12:25',room:'教室甲'}],special_dates:dates.map(date=>({date,kind:['2026-11-15','2026-12-27'].includes(date)?'practice':'lecture'})),remarks_raw:'上课时间：10.18、11.1、11.15、11.29、12.13、12.27、1.10、1.17。'};
 const term=timetableService(db).term('term');assert.deepEqual(expandCourse(normalizeCourse(raw,term),term).sessions.map(s=>s.date),dates);
 db.prepare('INSERT INTO public_courses(id,term_id,payload_json) VALUES(?,?,?)').run('confirmed','term',JSON.stringify(raw));
 const result=reconcileCourses(db,{apply:true});assert.equal(result.confirmedSchedulesFixed,1);const updated=JSON.parse(db.prepare('SELECT payload_json FROM public_courses WHERE id=?').get('confirmed').payload_json);
 assert.equal(updated.weekly_rules.length,0);assert.deepEqual(updated.explicit_sessions.map(s=>s.date),dates);assert.equal(updated.explicit_sessions.at(-1).week,18);assert.equal(updated.explicit_sessions.filter(s=>s.kind==='practice').length,2);
 const edited={...raw,explicit_sessions:[{date:'2027-01-08',start_time:'08:50',end_time:'12:25',room:'个人教室'}]};assert.ok(expandCourse(normalizeCourse(edited,term),term).sessions.some(s=>s.date==='2027-01-08'));
 assert.equal(reconcileCourses(db,{apply:true}).confirmedSchedulesFixed,0);db.close();
});
test('合并校历后，不把原来没有对应校历的旧周次误绑定到新校历',()=>{
 const db=fixture(),term=timetableService(db).term('term');
 const raw={course_name:'校历不明确',teacher:'老师',weekly_rules:[{weeks:[2],weekday:7,start_time:'08:00',end_time:'10:00'}]};
 assert.equal(expandCourse(normalizeCourse(raw,term),term).sessions.length,0);db.close();
});
