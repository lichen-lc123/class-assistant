import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {initTimetableSchema} from '../timetable-schema.mjs';
import {importConflicts} from '../import-conflicts.mjs';

const lesson=(date,start='08:00',end='10:00')=>({date,start_time:start,end_time:end,start:date+'T'+start+':00+08:00',end:(end<start?'2026-11-08':date)+'T'+end+':00+08:00',room:'教室甲'});
test('导入占用判断覆盖部分重叠、包含、跨午夜及同课内重叠，相邻时段可用',()=>{
  const existing=[{course_name:'已有课程',sessions:[lesson('2026-11-07')]}];
  const check=sessions=>importConflicts(existing,[{course_name:'新课程',sessions}]);
  assert.equal(check([lesson('2026-11-07','09:00','11:00')]).length,1);
  assert.equal(check([lesson('2026-11-07','07:00','11:00')]).length,1);
  assert.equal(check([lesson('2026-11-07','10:00','11:00')]).length,0);
  assert.equal(check([lesson('2026-11-08')]).length,0);
  assert.equal(check([]).length,0);
  assert.equal(check([lesson('2026-11-08','08:00','10:00'),lesson('2026-11-08','09:00','11:00')]).length,1);
  const night=[{course_name:'夜间课程',sessions:[lesson('2026-11-07','23:00','01:00')]}];
  assert.equal(importConflicts(night,[{course_name:'次日课程',sessions:[lesson('2026-11-08','00:30','02:00')]}]).length,1);
  assert.equal(importConflicts([...existing,...existing],[{course_name:'不受旧冲突影响',sessions:[lesson('2026-11-09')]}]).length,0);
});

function excel(date,name='表格课程',code='EXCEL'){
  const rows=[['课程名称','任课老师','上课时间地点','备注','教室'],[name,'老师',`班级编号${code}\n星期一 第1-1节`,date.replace(/-/g,'.'),'教室甲']];
  const cell=(v,i,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const files={'xl/workbook.xml':'<workbook><sheets><sheet name="课表" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>cell(v,i,j)).join('')}</row>`).join('')+'</sheetData></worksheet>'};
  const parts=[],central=[];let offset=0;
  for(const [name,content]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(content),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);parts.push(head,n,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=30+n.length+data.length;}
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return[{name:'课表.xlsx',content:Buffer.concat([...parts,directory,end]).toString('base64')}];
}

test('三种来源均可追加，重复时间整批拒绝，模板同步不删除额外课程',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'append-admin','学委','AppendAdminFixture123');
  const pw=await hashPassword('AppendStudentFixture123');for(const id of ['one','two','other'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('append-'+id,id,pw);
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'append-admin',password:'AppendAdminFixture123'})).cookie;
  const cookies={};for(const id of ['one','two','other'])cookies[id]=(await call('/auth/login','POST',{studentId:'append-'+id,password:'AppendStudentFixture123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-01',endsOn:'2027-01-31',config:{periods:[{number:1,start:'08:00',end:'10:00'}]}},admin)).data.id;
  const raw=(name,code,date,start='08:00',end='10:00')=>({course_name:name,teaching_class_code:code,teacher:'老师',explicit_sessions:[{date,start_time:start,end_time:end,room:'教室甲'}]});
  const publicInput=[raw('最初课程','BASE','2026-11-07'),raw('卡片新增','CARD','2026-11-10'),raw('另一模板课程','TWO','2026-11-11'),raw('冲突卡片','BLOCK','2026-11-07','09:00','11:00'),raw('管理员新增','ADMIN','2026-11-20'),raw('保存前变化','RACE','2026-11-22')];
  assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:publicInput,acceptWarnings:true},admin)).status,201);
  const catalog=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data,ids=Object.fromEntries(catalog.map(c=>[c.teaching_class_code,c.id]));
  const create=async(name,courseIds)=>(await call('/admin/timetable/templates','POST',{termId,name,courseIds},admin)).data.id;
  const template=await create('初始模板',[ids.BASE]),second=await create('第二模板',[ids.TWO]),blocked=await create('冲突模板',[ids.BLOCK]);
  const get=async(cookie=cookies.one)=>(await call('/timetable/'+termId,'GET',undefined,cookie)).data;
  const save=async(input,cookie=cookies.one)=>call('/timetable/'+termId,'POST',{...input,revision:(await get(cookie)).timetable?.revision||0,acceptWarnings:true},cookie);
  const preview=(input,cookie=cookies.one)=>call(input.source==='template'||input.source==='cards'?'/timetable/selection-preview':'/timetable/preview','POST',{termId,...input},cookie);
  await t.test('模板起步后追加AI、另一批AI、模板和卡片，其他用户独立',async()=>{
    assert.equal((await save({source:'template',templateId:template})).status,200);
    assert.equal((await save({source:'cards',courseIds:[ids.BASE]},cookies.two)).status,200);
    for(const input of [{source:'ai',courses:[raw('AI新增','AI','2026-11-08')]},{source:'ai',courses:[raw('第二批AI','EXCEL','2026-11-09')]},{source:'template',templateId:second},{source:'cards',courseIds:[ids.CARD]}]){
      const p=await preview(input);assert.equal(p.status,200);assert.equal(p.data.importBlocked,false);assert.equal((await save(input)).status,200);
    }
    assert.equal((await get()).courses.length,5);assert.equal((await get(cookies.two)).courses.length,1);assert.equal((await get(cookies.other)).timetable,null);
    assert.equal((await save({source:'ai',courses:[raw('卡片后的AI','TWO-AI','2026-11-08')]},cookies.two)).status,200);
  });
  await t.test('三类导入均提示重复时段，确认标记不能绕过，整批不留半份数据',async()=>{
    const before=await get(),rows=db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),subs=db.prepare('SELECT * FROM timetable_template_subscriptions').all();
    const inputs=[{source:'ai',courses:[raw('本可添加','OK','2026-11-21'),raw('冲突AI','BAD-AI','2026-11-07','09:00','11:00')]},{source:'template',templateId:blocked},{source:'cards',courseIds:[ids.BLOCK]}];
    for(const input of inputs){const p=await preview(input);assert.equal(p.status,200);assert.equal(p.data.importBlocked,true);assert.match(p.data.importError,/课程时间重复/);assert.match(p.data.importError,/2026-11-07/);assert.ok(p.data.importError.includes('最初课程'));assert.equal((await save(input)).status,409);}
    assert.equal((await get()).timetable.revision,before.timetable.revision);assert.deepEqual(db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),rows);assert.deepEqual(db.prepare('SELECT * FROM timetable_template_subscriptions').all(),subs);
  });
  await t.test('导入批次内部冲突被拒绝，日期不同或首尾相接可以追加',async()=>{
    assert.equal((await save({source:'ai',courses:[raw('同批甲','BATCH-A','2026-11-23'),raw('同批乙','BATCH-B','2026-11-23','09:00','11:00')]})).status,409);
    assert.equal((await save({source:'ai',courses:[raw('相邻课','ADJ','2026-11-07','10:00','11:00')]})).status,200);
    assert.equal((await save({source:'ai',courses:[raw('不同日期','DIFF','2026-11-24')]})).status,200);
    const next=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第二学期',startsOn:'2027-02-01',endsOn:'2027-06-30'},admin)).data.id;
    assert.equal((await call('/timetable/'+next,'POST',{source:'ai',courses:[raw('其他学期已占用','OTHER-TERM','2027-02-27')],acceptWarnings:true},cookies.one)).status,200);
    const occupied=await save({source:'ai',courses:[raw('跨范围重复','CROSS-TERM','2027-02-27')]});assert.equal(occupied.status,409);assert.match(occupied.data.message,/其他学期已占用/);
  });
  await t.test('按个人最终时间检查占用，保存时重新检查最新卡片内容',async()=>{
    let table=await get();const entry=table.courses.find(c=>c.teaching_class_code==='BASE');
    assert.equal((await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:table.timetable.revision,publicRevision:entry.publicRevision,sessions:[{date:'2026-11-25',start_time:'08:00',end_time:'10:00',room:'个人地点'}]},cookies.one)).status,200);
    assert.equal((await save({source:'ai',courses:[raw('撞个人安排','CUSTOM-BAD','2026-11-25')]})).status,409);
    const p=await preview({source:'cards',courseIds:[ids.RACE]});assert.equal(p.data.importBlocked,false);
    const c=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data.find(c=>c.id===ids.RACE);
    assert.equal((await call('/admin/timetable/courses/'+c.id,'PUT',{course:raw('保存前变化','RACE','2026-11-25'),revision:c.revision,acceptWarnings:true},admin)).status,200);
    assert.equal((await save({source:'cards',courseIds:[ids.RACE]})).status,409);
    assert.equal((await save({source:'ai',courses:[raw('原时间已空闲','FREE','2026-11-07')]})).status,200);
  });
  await t.test('多模板同步按来源维护，AI表格和卡片追加课程均保留，重合来源不重复建课',async()=>{
    const edit=async(id,courseIds)=>{const tpl=(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===id);return call('/admin/timetable/templates/'+id,'PUT',{name:tpl.name,revision:tpl.revision,courseIds},admin);};
    assert.equal((await edit(template,[ids.ADMIN])).status,200);
    let table=await get();assert.ok(!table.courses.some(x=>x.teaching_class_code==='BASE'));for(const code of ['ADMIN','AI','EXCEL','TWO','CARD','ADJ','DIFF','FREE'])assert.ok(table.courses.some(x=>x.teaching_class_code===code),code);
    assert.equal((await edit(second,[ids.CARD])).status,200);table=await get();assert.equal(table.courses.filter(x=>x.publicCourseId===ids.CARD).length,1);assert.ok(!table.courses.some(x=>x.teaching_class_code==='TWO'));
    assert.equal((await edit(second,[ids.ADMIN])).status,200);table=await get();assert.ok(table.courses.some(x=>x.teaching_class_code==='CARD'));assert.equal(table.courses.filter(x=>x.publicCourseId===ids.ADMIN).length,1);
    assert.equal((await get(cookies.two)).courses.find(x=>x.teaching_class_code==='BASE').course_name,'最初课程');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  });
  await t.test('版本保护与清空仍有效，来源链接一并清除且不影响他人',async()=>{
    const table=await get();assert.equal((await call('/timetable/'+termId,'POST',{source:'ai',revision:0,courses:[raw('旧页面','STALE','2026-11-28')],acceptWarnings:true},cookies.one)).status,409);
    assert.equal((await call('/timetable/'+termId,'DELETE',{revision:table.timetable.revision,confirm:true},cookies.one)).status,200);
    assert.equal(db.prepare('SELECT count(*) n FROM timetable_template_subscriptions').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM timetable_entry_templates').get().n,0);assert.equal((await get(cookies.two)).courses.length,2);
  });
});

test('旧数据库迁移保留模板关系和个人资料，重复初始化不把新增课程归入旧模板',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');
  initTimetableSchema(db);
  db.exec(`INSERT INTO terms(id,academic_year,name) VALUES('term','2026-2027','第一学期');
    INSERT INTO public_courses(id,term_id,payload_json) VALUES('course','term','{}');
    INSERT INTO timetable_templates(id,term_id,name) VALUES('template','term','旧模板');
    INSERT INTO template_courses(template_id,course_id) VALUES('template','course');
    INSERT INTO timetables(id,user_id,term_id,source,template_id,template_revision) VALUES('tpl',1,'term','template','template',1),('own',2,'term','ai',NULL,NULL);
    INSERT INTO timetable_entries(id,timetable_id,course_id,private_json,override_json) VALUES('old-tpl','tpl','course',NULL,'{"room_overrides":{"0":"个人教室"}}'),('old-own','own',NULL,'{"course_name":"个人课程"}',NULL);
    DROP TABLE timetable_entry_templates;DROP TABLE timetable_template_subscriptions;ALTER TABLE timetable_entries DROP COLUMN direct_source;`);
  initTimetableSchema(db);
  assert.equal(db.prepare('SELECT count(*) n FROM timetable_template_subscriptions').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM timetable_entry_templates').get().n,1);
  assert.equal(db.prepare('SELECT direct_source FROM timetable_entries WHERE id=?').get('old-own').direct_source,'ai');assert.match(db.prepare('SELECT override_json FROM timetable_entries WHERE id=?').get('old-tpl').override_json,/个人教室/);
  db.prepare('INSERT INTO timetable_entries(id,timetable_id,private_json,direct_source) VALUES(?,?,?,?)').run('additional','tpl','{"course_name":"补充课程"}','ai');
  initTimetableSchema(db);assert.equal(db.prepare('SELECT count(*) n FROM timetable_entry_templates').get().n,1);assert.equal(db.prepare('SELECT direct_source FROM timetable_entries WHERE id=?').get('additional').direct_source,'ai');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});
