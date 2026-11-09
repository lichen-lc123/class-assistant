import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {homeworkCourseTime,matchesHomeworkCourseTime} from '../homework-course-time.mjs';

const course=(name='后补课程',teacher='补课老师',time='08:00')=>({course_name:name,teacher,explicit_sessions:[{date:'2026-11-14',start_time:time,end_time:time==='08:00'?'10:00':'14:00',room:'教室甲'}]});
const draft=(title='第一次作业',extra={})=>({kind:'assignment',title,course_name:'后补课程',teacher:'补课老师',content:'先发布的作业内容',targetKeys:[],published:false,auto_publish_on_match:true,attachments:[],source_rows:[{sheet:'测试表',row:2}],...extra});
test('备注中的明确上课时间用于核对，截止不限制课程，复杂日期时段不交叉猜配',()=>{
 assert.equal(homeworkCourseTime({notes:'上课时间：星期六 08:00—10:00'}),'星期六 08:00—10:00');
 assert.equal(homeworkCourseTime({source_rows:[{raw:{截止时间:'2026-11-14 12:00'}}]}),'');
 assert.equal(matchesHomeworkCourseTime('2026-11-14 08:00—10:00；2026-11-21 12:00—14:00',[{date:'2026-11-14',start_time:'12:00',end_time:'14:00'}]),false);
});
async function setup(t){
 const app=await createApp({databasePath:':memory:'});const {db,server}=app;
 await createInitialAdmin(db,'pending-admin','管理员','PendingFixture123');
 db.prepare('INSERT INTO users(student_id,name,role,password_hash,must_change_password) VALUES(?,?,?,?,0)').run('pending-student','同学','student',await hashPassword('PendingFixture123'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const admin=(await call('/auth/login','POST',{studentId:'pending-admin',password:'PendingFixture123'})).cookie;
 const student=(await call('/auth/login','POST',{studentId:'pending-student',password:'PendingFixture123'})).cookie;
 const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期'},admin)).data.id;
 const records=async()=>(await call('/admin/homework?termId='+termId,'GET',undefined,admin)).data.records;
 const importWork=(records,assets=[])=>call('/admin/homework/import','POST',{termId,records,assets,confirm:true},admin);
 const addCourses=(courses,extra={})=>call('/admin/timetable/courses','POST',{termId,source:courses.length===1?'manual':'ai',courses,acceptWarnings:true,...extra},admin);
 return{db,base,call,admin,student,termId,records,importWork,addCourses};
}

test('先导作业和附件，后增加课程：自动关联发布，保留原ID、文件、计划和完成状态',async t=>{
 const f=await setup(t),bytes=Buffer.from('%PDF-1.4\npending attachment\n%%EOF'),id=createHash('sha256').update(bytes).digest('hex');
 const assets=[{id,mime:'application/octet-stream',content:bytes.toString('base64')}];
 assert.equal((await f.importWork([draft('第一次作业',{attachments:[{assetId:id,field:'content',filename:'原作业.pdf'}]}),draft('课程考核',{kind:'reference',content:'',assessment_rules:'课程考核内容'})],assets)).status,201);
 const before=await f.records(),work=before.find(r=>r.kind==='assignment'),user=f.db.prepare("SELECT id FROM users WHERE student_id='pending-student'").get().id;
 assert.equal(work.published,false);assert.match(work.draftReason,/自动关联并发布/);
 f.db.prepare('INSERT INTO homework_preferences(user_id,record_id,priority,planned_date) VALUES(?,?,?,?)').run(user,work.id,'high','2026-11-12');
 f.db.prepare('INSERT INTO homework_completions(user_id,record_id,completed_revision) VALUES(?,?,?)').run(user,work.id,work.revision);
 assert.equal((await f.addCourses([course()])).status,201);
 const after=await f.records();assert.equal(after.length,2);assert.ok(after.every(r=>r.published&&r.targets.length===1));
 const current=after.find(r=>r.id===work.id);assert.equal(current.revision,work.revision+1);assert.equal(current.content,work.content);assert.equal(current.attachments[0].filename,'原作业.pdf');
 const file=await fetch(f.base+current.attachments[0].url,{headers:{Cookie:f.admin}});
 assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
 const asset=f.db.prepare('SELECT bytes FROM homework_assets WHERE id=?').get(id);assert.deepEqual(Buffer.from(asset.bytes),bytes);
 const cards=(await f.call('/timetable/cards?termId='+f.termId,'GET',undefined,f.student)).data;
 assert.equal((await f.call('/timetable/'+f.termId,'POST',{source:'cards',courseIds:[cards[0].id],acceptWarnings:true},f.student)).status,200);
 const mine=(await f.call('/homework?termId='+f.termId,'GET',undefined,f.student)).data.records.find(r=>r.id===work.id);
 assert.equal(mine.completed,true);assert.equal(mine.priority,'high');assert.equal(mine.planned_date,'2026-11-12');
 assert.equal((await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.admin)).data.published,0);
});

test('同批新增同名同老师不同时段会共同匹配；跨学期、错老师和下架课程均不匹配',async t=>{
 const f=await setup(t);await f.importWork([draft()]);
 assert.equal((await f.addCourses([course(),course('后补课程','补课老师','12:00')])).status,201);
 let record=(await f.records())[0];assert.equal(record.published,true);assert.equal(record.targets.length,2);
 assert.equal((await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.student)).status,403);
 assert.equal((await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.admin)).data.published,0);
 const other=(await f.call('/admin/timetable/terms','POST',{academicYear:'2027-2028',name:'另一个学期'},f.admin)).data.id;
 await f.call('/admin/timetable/courses','POST',{termId:other,source:'manual',courses:[course()],acceptWarnings:true},f.admin);
 assert.equal((await f.records())[0].targets.length,2);
 const g=await setup(t);await g.importWork([draft()]);await g.addCourses([course('后补课程','别的老师')]);assert.equal((await g.records())[0].published,false);
 await g.addCourses([course()],{published:false});assert.equal((await g.records())[0].published,false);
 const card=(await g.call('/admin/timetable/courses?termId='+g.termId,'GET',undefined,g.admin)).data.find(c=>c.teacher==='补课老师');
 assert.equal((await g.call('/admin/timetable/courses/'+card.id,'PUT',{revision:card.revision,course:card,published:true,cardEnabled:true,acceptWarnings:true},g.admin)).status,200);
 assert.equal((await g.records())[0].published,true);
});

test('主动保存的草稿不自动发布，旧版未编辑导入可兼容匹配，旧版编辑过的草稿保留人工决定',async t=>{
 const f=await setup(t);await f.importWork([draft('等待匹配'),draft('主动草稿',{auto_publish_on_match:false}),draft('旧版导入'),draft('旧版编辑过')]);
 const old=await f.records();for(const row of old.filter(r=>r.title.startsWith('旧版'))){const raw=f.db.prepare('SELECT * FROM homework_records WHERE id=?').get(row.id),payload=JSON.parse(raw.payload_json);delete payload.auto_publish_on_match;f.db.prepare('UPDATE homework_records SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(payload),row.title==='旧版编辑过'?'2026-12-01T00:00:00Z':raw.created_at,row.id);}
 const waiting=old.find(r=>r.title==='等待匹配');
 assert.equal((await f.call('/admin/homework/records/'+waiting.id,'PUT',{revision:waiting.revision,record:{...waiting,targetKeys:[],auto_publish_on_match:false}},f.admin)).status,200);
 await f.addCourses([course()]);const after=await f.records();
 assert.equal(after.find(r=>r.title==='旧版导入').published,true);
 for(const title of ['等待匹配','主动草稿','旧版编辑过'])assert.equal(after.find(r=>r.title===title).published,false);
});

test('AI模板新增课程触发匹配；管理页补扫可处理已有唯一课程，不在只读GET中修改内容',async t=>{
 const f=await setup(t);await f.importWork([draft()]);
 const preview=await f.call('/admin/timetable/template-preview','POST',{termId:f.termId,source:'ai',courses:[course()]},f.admin);assert.equal(preview.status,200);
 const saved=await f.call('/admin/timetable/template-import','POST',{termId:f.termId,source:'ai',courses:[course()],name:'后补模板',catalogVersion:preview.data.catalogVersion,acceptWarnings:true},f.admin);assert.equal(saved.status,201,JSON.stringify(saved.data));
 assert.equal((await f.records())[0].published,true);
 const g=await setup(t);await g.addCourses([course()]);await g.call('/admin/homework/records','POST',{termId:g.termId,record:draft()},g.admin);
 assert.equal((await g.records())[0].published,false);
 const matched=await g.call('/admin/homework/match-pending','POST',{termId:g.termId},g.admin);assert.equal(matched.data.published,1);assert.equal((await g.records())[0].published,true);
});

test('学生后用AI增加个人课程，也可匹配先导入的公共作业；主动草稿保持未发布',async t=>{
 const f=await setup(t);await f.importWork([draft('自动匹配'),draft('保留草稿',{auto_publish_on_match:false})]);
 const added=await f.call('/timetable/'+f.termId,'POST',{source:'ai',courses:[course()],acceptWarnings:true},f.student);
 assert.equal(added.status,200,JSON.stringify(added.data));
 const record=(await f.records()).find(r=>r.title==='自动匹配');assert.equal(record.published,true);assert.ok(record.targets[0].identityKey);assert.equal(record.targets[0].courseId,null);
 const mine=(await f.call('/homework?termId='+f.termId,'GET',undefined,f.student)).data.records;assert.equal(mine.length,1);assert.equal(mine[0].id,record.id);
 assert.equal((await f.records()).find(r=>r.title==='保留草稿').published,false);
 assert.equal((await f.call('/homework?termId='+f.termId,'GET',undefined,f.admin)).data.records.length,0);
});

test('无时间限定的作业涵盖所有同名同老师课程，后补课程继续关联且保留个人完成',async t=>{
 const f=await setup(t);await f.importWork([draft()]);await f.addCourses([course()]);
 const first=(await f.records())[0],card=first.targets[0].courseId;
 await f.call('/timetable/'+f.termId,'POST',{source:'cards',courseIds:[card],acceptWarnings:true},f.student);
 await f.call('/homework/records/'+first.id+'/completion','POST',{completed:true,revision:first.revision},f.student);
 await f.addCourses([course('后补课程','补课老师','12:00')]);
 const second=(await f.records())[0];assert.equal(second.id,first.id);assert.equal(second.targets.length,2);assert.equal(second.audience_mode,'family');
 const mine=(await f.call('/homework','GET',undefined,f.student)).data.records.find(r=>r.id===first.id);assert.equal(mine.completed,true);
 assert.equal((await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.admin)).data.expanded,0);
});

test('明确上课时间只匹配对应时段，部分或不可识别的时间保留草稿；多选课程可无截止发布',async t=>{
 const f=await setup(t);await f.importWork([draft('指定时段',{course_time:'2026-11-14 08:00—10:00'}),draft('时间不足',{course_time:'星期六'}),draft('时间不明',{course_time:'另行安排'})]);
 await f.addCourses([course(),course('后补课程','补课老师','12:00')]);
 const records=await f.records();assert.equal(records.find(r=>r.title==='指定时段').published,true);assert.equal(records.find(r=>r.title==='指定时段').targets.length,1);
 for(const title of ['时间不足','时间不明'])assert.equal(records.find(r=>r.title===title).published,false);
 const cards=(await f.call('/admin/timetable/courses?termId='+f.termId,'GET',undefined,f.admin)).data;
 const manual=await f.call('/admin/homework/records','POST',{termId:f.termId,record:{...draft('多选且无截止'),source_rows:[],auto_publish_on_match:false,autoPublish:true,targetKeys:cards.map(c=>'course:'+c.id)}},f.admin);
 assert.equal(manual.status,201);assert.equal(manual.data.published,true);assert.equal(manual.data.targets.length,2);assert.equal(manual.data.due_date,null);assert.equal(manual.data.due_time,null);
 const first=await f.call('/timetable/'+f.termId,'POST',{source:'cards',courseIds:[cards[0].id],acceptWarnings:true},f.student);assert.equal(first.status,200);
 assert.ok((await f.call('/homework','GET',undefined,f.student)).data.records.some(r=>r.id===manual.data.id));
});

test('待核对内容始终存草稿，课程补齐不绕过确认，管理员确认后可无截止发布',async t=>{
 const f=await setup(t);await f.addCourses([course()]);
 const saved=await f.importWork([draft('待确认',{review_required:true,review_reasons:['原表内容无法确定'],audience_mode:'family'})]);assert.equal(saved.status,201);
 const record=(await f.records())[0];assert.equal(record.published,false);assert.match(record.draftReason,/待管理员确认/);
 assert.equal((await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.admin)).data.published,0);
 assert.equal((await f.call('/admin/homework/records/'+record.id+'/publish','POST',{revision:record.revision},f.admin)).status,400);
 const card=(await f.call('/admin/timetable/courses?termId='+f.termId,'GET',undefined,f.admin)).data[0];
 const edited=await f.call('/admin/homework/records/'+record.id,'PUT',{revision:record.revision,record:{...record,targetKeys:['course:'+card.id],review_required:false,auto_publish_on_match:false}},f.admin);assert.equal(edited.status,200);
 assert.equal((await f.call('/admin/homework/records/'+record.id+'/publish','POST',{revision:edited.data.revision},f.admin)).data.published,true);
});

test('导论保持日期时段对应关系，不参与同名同老师的跨班自动扩展',async t=>{
 const f=await setup(t);await f.addCourses([course('工程管理导论','导论老师'),course('工程管理导论','导论老师','12:00')]);
 await f.importWork([draft('导论待核对',{course_name:'工程管理导论',teacher:'导论老师'})]);
 assert.equal((await f.records())[0].published,false);
 const cards=(await f.call('/admin/timetable/courses?termId='+f.termId,'GET',undefined,f.admin)).data;
 const saved=await f.call('/admin/homework/records','POST',{termId:f.termId,record:{...draft('导论指定班',{course_name:'工程管理导论',teacher:'导论老师'}),published:true,targetKeys:['course:'+cards[0].id]}},f.admin);
 assert.equal(saved.status,201);assert.equal(saved.data.targets.length,1);
 await f.call('/admin/homework/match-pending','POST',{termId:f.termId},f.admin);
 assert.equal((await f.records()).find(r=>r.id===saved.data.id).targets.length,1);
 assert.equal((await f.records()).find(r=>r.title==='导论待核对').published,false);
});
