import {courseTarget} from './fixtures/course-target.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {timetableService} from '../timetable.mjs';
import {homeworkService} from '../homework.mjs';
import {homeworkCompletionAction} from '../homework-notification-actions.mjs';
import {reminderDefaults} from '../reminder-settings.mjs';

test('手机完成动作携带作业版本，固定提交完成而非切换状态，链接不带登录令牌',()=>{
  const id='12345678-1234-1234-1234-123456789012',action=homeworkCompletionAction({id,revision:4});
  assert.equal(action.title,'完成');assert.equal(action.request.method,'POST');assert.deepEqual(action.request.body,{completed:true,revision:4});assert.equal(action.request.path,`/api/homework/records/${id}/completion`);
  const url=new URL(action.openUrl,'https://example.test');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('completeHomework'),id);assert.equal(url.searchParams.get('homeworkRevision'),'4');assert.equal([...url.searchParams].length,2);
});
test('完成立即阻断本人全部后续作业提醒，重复点击不撤销；其他同学、旧版本和越权操作被隔离',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'notify-admin','学委','NotificationAdmin123');const hash=await hashPassword('NotificationStudent123');for(const id of ['notify-one','notify-two'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,hash);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'notify-admin',password:'NotificationAdmin123'})).cookie,one=(await call('/auth/login','POST',{studentId:'notify-one',password:'NotificationStudent123'})).cookie,two=(await call('/auth/login','POST',{studentId:'notify-two',password:'NotificationStudent123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'秋冬学期'},admin)).data.id;
  for(const cookie of [one,two])assert.equal((await call('/timetable/'+termId,'POST',{source:'ai',acceptWarnings:true,courses:[{course_name:'通知课程',teacher:'老师',teaching_class_code:'NOTICE-A',explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}]},cookie)).status,200);
  const record={kind:'assignment',title:'需要完成的作业',course_name:'通知课程',teacher:'老师',content:'完成报告',targetKeys:[courseTarget(db,'NOTICE-A')],published:true,due_date:'2026-11-20',due_time:'22:00'};
  const shared=(await call('/admin/homework/records','POST',{termId,record},admin)).data,oneId=db.prepare("SELECT id FROM users WHERE student_id='notify-one'").get().id,twoId=db.prepare("SELECT id FROM users WHERE student_id='notify-two'").get().id;
  const service=homeworkService(db,timetableService(db));
  const queued=service.reminderCandidate(oneId,shared.id,1);assert.ok(queued);assert.ok(service.reminderCandidate(oneId,shared.id,1,'update'));assert.equal(service.reminderCandidate(oneId,shared.id,99),null);
  assert.equal((await call('/homework/records/'+shared.id)).status,401);
  const detail=await call('/homework/records/'+shared.id,'GET',undefined,one);assert.equal(detail.status,200);assert.equal(detail.data.completed,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_completions').get().n,0);
  const action=queued.completeAction,complete=await call(action.request.path.slice(4),action.request.method,action.request.body,one);assert.equal(complete.status,200);assert.equal(complete.data.completed,true);assert.equal(complete.data.remindersSuppressed,true);assert.ok(complete.data.completedAt);
  assert.equal(service.reminderCandidate(oneId,queued.recordId,queued.revision),null);assert.equal(service.reminderCandidate(oneId,shared.id,1,'update'),null);assert.ok(service.reminderCandidate(twoId,shared.id,1));assert.equal((await call('/homework/summary','GET',undefined,one)).data.pendingCount,0);
  db.prepare("UPDATE homework_completions SET updated_at='2026-11-04T01:00:00.000Z' WHERE user_id=? AND record_id=?").run(oneId,shared.id);
  const repeated=await call(action.request.path.slice(4),action.request.method,action.request.body,one);assert.equal(repeated.data.completed,true);assert.equal(repeated.data.completedAt,'2026-11-04T01:00:00.000Z');assert.equal(service.reminderCandidate(oneId,shared.id,1),null);
  assert.equal((await call(action.request.path.slice(4),'POST',{completed:false,revision:1},one)).status,200);assert.ok(service.reminderCandidate(oneId,shared.id,1));
  const newer=await call('/admin/homework/records/'+shared.id,'PUT',{revision:1,record:{...record,content:'更新后的报告要求'}},admin);assert.equal(newer.data.revision,2);assert.equal(service.reminderCandidate(oneId,shared.id,1),null);assert.equal((await call(action.request.path.slice(4),'POST',action.request.body,one)).status,409);assert.ok(service.reminderCandidate(oneId,shared.id,2));
  const prefs=await call('/reminder-settings','PUT',{...reminderDefaults,revision:0,homeworkDueEnabled:false,homeworkUpdatesEnabled:false},one);assert.equal(prefs.status,200);assert.equal(service.reminderCandidate(oneId,shared.id,2),null);assert.equal(service.reminderCandidate(oneId,shared.id,2,'update'),null);
  const personal=(await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'私人作业',course_entry_id:(await call('/timetable/'+termId,'GET',undefined,one)).data.courses[0].id}},one)).data;
  assert.equal((await call('/homework/records/'+personal.id,'GET',undefined,two)).status,403);assert.equal((await call('/homework/records/'+personal.id,'GET',undefined,admin)).status,403);assert.equal(service.reminderCandidate(twoId,personal.id,1),null);
  assert.equal((await call('/homework/records/'+personal.id+'/completion','POST',{completed:true,revision:1},two)).status,403);assert.equal((await call('/homework/records/'+personal.id+'/completion','POST',{completed:true,revision:1},one)).data.remindersSuppressed,true);
});
