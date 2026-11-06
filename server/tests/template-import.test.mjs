import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

const semester={academicYear:'2026-2027',name:'秋冬学期',startsOn:'2026-09-01',endsOn:'2027-01-31'};
const course=(name,code,day='2026-11-07',room='教室甲')=>({course_name:name,teaching_class_code:code,teacher:'任课老师',explicit_sessions:[{date:day,start_time:'08:00',end_time:'10:00',room}]});
function zip(files){const parts=[],central=[];let offset=0;for(const [name,content]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(content),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);parts.push(head,n,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=30+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
function workbook(){const cell=(ref,value)=>`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;return zip({'xl/workbook.xml':'<workbook><sheets><sheet name="课程" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet><sheetData><row r="1">${cell('A1','课程名称')}${cell('B1','课程编号')}<c r="C1"/>${cell('D1','任课老师')}${cell('E1','上课时间地点')}${cell('F1','学期')}</row><row r="2">${cell('A2','Excel课程')}${cell('B2','00123')}<c r="C2"/>${cell('D2','Excel老师')}${cell('E2','班级编号EXCEL-SHARED')}${cell('F2','秋冬学期')}</row></sheetData></worksheet>`}).toString('base64');}
test('学委导入多份模板时自动生成卡片，重合上课班共用卡片且保留各自组合',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'template-admin','学委','TemplateImportAdmin123');const pw=await hashPassword('TemplateImportStudent123');for(const id of ['template-student','template-peer','template-import-fixture'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,pw);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'template-admin',password:'TemplateImportAdmin123'})).cookie,student=(await call('/auth/login','POST',{studentId:'template-student',password:'TemplateImportStudent123'})).cookie,peer=(await call('/auth/login','POST',{studentId:'template-peer',password:'TemplateImportStudent123'})).cookie;
  const importStudent=(await call('/auth/login','POST',{studentId:'template-import-fixture',password:'TemplateImportStudent123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',semester,admin)).data.id;
  const a=course('工程经济学','SHARED-A'),b=course('系统工程','CLASS-B','2026-11-08'),c=course('工程经济学','OTHER-C','2026-11-09');
  const inspect=async(courses,extra={})=>call('/admin/timetable/template-preview','POST',{termId,source:'ai',courses,...extra},admin);
  const save=async(name,p,extra={})=>call('/admin/timetable/template-import','POST',{termId,source:'ai',name,courses:p.courses,catalogVersion:p.catalogVersion,acceptWarnings:true,...extra},admin);
  await t.test('管理员模板只支持AI内容与Excel两种导入方式',async()=>{
    const p=(await inspect([a])).data;
    for(const source of ['excel','manual','cards','template']){
      assert.equal((await inspect([a],{source})).status,400);
      assert.equal((await save('无效导入方式',p,{source})).status,400);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM timetable_templates').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,0);
  });
  await t.test('预览不写入，未确认、未登录及学生管理请求被拒绝',async()=>{
    assert.equal((await call('/admin/timetable/template-preview','POST',{termId,source:'ai',courses:[a]})).status,401);assert.equal((await call('/admin/timetable/template-import','POST',{termId},student)).status,403);
    const p=(await inspect([a,b,a])).data;assert.equal(p.courses.length,2);assert.equal(p.stats.newCourses,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM timetable_templates').get().n,0);
    assert.equal((await save('未确认模板',p,{acceptWarnings:false})).status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,0);
  });
  let templateOne,templateTwo,idA;
  await t.test('甲模板含甲乙课程，乙模板含甲丙课程；甲课程仅一张卡片',async()=>{
    const p=(await inspect([a,b])).data,one=await save('模板一',p);assert.equal(one.status,201);assert.equal(one.data.created,2);assert.equal(one.data.cardsCreated,2);templateOne=one.data.id;
    const next=(await inspect([{...a,explicit_sessions:[{...a.explicit_sessions[0],room:'新文件中的不同地点'}]},c])).data;assert.equal(next.stats.reusedCourses,1);assert.equal(next.stats.newCourses,1);assert.ok(!next.warnings.some(w=>w.includes('沿用已有卡片')));assert.equal(next.courses.find(x=>x.teaching_class_code==='SHARED-A').sessions[0].room,'教室甲');
    const two=await save('模板二',next);assert.equal(two.status,201);assert.equal(two.data.created,1);assert.equal(two.data.reused,1);assert.equal(two.data.cardsCreated,1);templateTwo=two.data.id;
    const cards=(await call('/timetable/cards?termId='+termId,'GET',undefined,student)).data;assert.equal(cards.length,3);idA=cards.find(x=>x.teaching_class_code==='SHARED-A').id;assert.equal(cards.filter(x=>x.course_name==='工程经济学').length,2);
    const templates=(await call('/timetable/templates?termId='+termId,'GET',undefined,student)).data;const first=templates.find(x=>x.id===templateOne),second=templates.find(x=>x.id===templateTwo);assert.equal(first.courseIds.length,2);assert.equal(second.courseIds.length,2);assert.deepEqual(first.courseIds.filter(id=>second.courseIds.includes(id)),[idA]);
    const own=await call('/timetable/'+termId,'POST',{source:'template',templateId:templateOne,acceptWarnings:true},student),other=await call('/timetable/'+termId,'POST',{source:'template',templateId:templateTwo,acceptWarnings:true},peer);assert.equal(own.status,200);assert.equal(other.status,200);assert.ok(own.data.courses.some(x=>x.teaching_class_code==='CLASS-B'));assert.ok(!own.data.courses.some(x=>x.teaching_class_code==='OTHER-C'));assert.ok(other.data.courses.some(x=>x.teaching_class_code==='OTHER-C'));
  });
  await t.test('相同课程组合可以成为另一模板，不新增卡片；重名拒绝且不留下孤立课程',async()=>{
    const p=(await inspect([a,b])).data,result=await save('模板三',p);assert.equal(result.data.created,0);assert.equal(result.data.reused,2);assert.equal(result.data.cardsCreated,0);
    const duplicate=(await inspect([course('不应留下的新课','ROLLBACK-D')])).data;assert.equal((await save('模板一',duplicate)).status,409);assert.equal(db.prepare("SELECT id FROM public_courses WHERE json_extract(payload_json,'$.teaching_class_code')='ROLLBACK-D'").get(),undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM timetable_templates').get().n,3);
    assert.equal((await call('/admin/timetable/templates','POST',{termId,name:'模板一',courseIds:[idA]},admin)).status,409);
    const second=(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===templateTwo);assert.equal((await call('/admin/timetable/templates/'+templateTwo,'PUT',{name:'模板一',courseIds:second.courseIds,revision:second.revision},admin)).status,409);
  });
  await t.test('导入期间卡片变动需重新预览，同班不同课程老师不允许错误合并',async()=>{
    const stale=(await inspect([a])).data,old=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===idA);
    assert.equal((await call('/admin/timetable/courses/'+idA,'PUT',{course:{...a,explicit_sessions:[{...a.explicit_sessions[0],room:'正式更新教室'}]},revision:old.revision,acceptWarnings:true},admin)).status,200);
    assert.equal((await save('旧预览不能保存',stale)).status,409);assert.equal((await inspect([{...a,teacher:'另一位老师'}])).status,200);assert.equal((await inspect([a,{...a,teacher:'冲突老师'}])).status,200);
  });
  await t.test('无班号仅在老师与完整排课一致时去重；待通知课程不能凭名称合并',async()=>{
    const noCode=course('没有班号的明确课程',null,'2026-11-15');const first=await save('无班号模板甲',(await inspect([noCode])).data);assert.equal(first.data.created,1);
    const second=await save('无班号模板乙',(await inspect([{...noCode,remarks_raw:'来自另一位同学的备注'}])).data);assert.equal(second.data.created,0);assert.equal(second.data.reused,1);
    const pending={course_name:'时间待通知课程',teacher:'任课老师'};const p=(await inspect([pending])).data;assert.ok(p.warnings.some(w=>w.includes('暂不自动匹配')));assert.equal((await save('待通知模板甲',p)).data.created,1);assert.equal((await save('待通知模板乙',(await inspect([pending])).data)).data.created,1);
  });
  await t.test('恢复已有未生成或下架的卡片，不创建另一张；不同学期不混合去重',async()=>{
    const legacy=course('旧课程卡片','LEGACY-CLASS','2026-11-20');assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:[legacy],generateCards:false,acceptWarnings:true},admin)).status,201);
    let row=db.prepare("SELECT * FROM public_courses WHERE json_extract(payload_json,'$.teaching_class_code')='LEGACY-CLASS'").get();db.prepare('UPDATE public_courses SET published=0 WHERE id=?').run(row.id);
    const p=(await inspect([legacy])).data;assert.ok(p.warnings.some(w=>w.includes('恢复发布')));const result=await save('恢复卡片的模板',p);assert.equal(result.data.created,0);assert.equal(result.data.reused,1);assert.equal(result.data.cardsCreated,1);row=db.prepare('SELECT * FROM public_courses WHERE id=?').get(row.id);assert.equal(row.card_enabled,1);assert.equal(row.published,1);
    const nextTerm=(await call('/admin/timetable/terms','POST',{...semester,name:'下一学期',startsOn:'2027-02-01',endsOn:'2027-06-30'},admin)).data.id;const other=(await inspect([course('工程经济学','SHARED-A','2027-03-01')],{termId:nextTerm})).data;
    assert.equal((await save('下学期模板',other,{termId:nextTerm})).data.created,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM public_courses WHERE json_extract(payload_json,'$.teaching_class_code')='SHARED-A'").get().n,2);
  });
  await t.test('Excel模板导入已停用，预览和保存都拒绝',async()=>{
    const p=(await inspect([a])).data;
    assert.equal((await inspect(undefined,{source:'excel',files:[{name:'课表.xlsx',content:workbook()}]})).status,400);
    assert.equal((await save('不能再导入Excel',p,{source:'excel'})).status,400);
  });
  await t.test('同一学年各学期可保存多份模板，不占用或覆盖个人课表',async()=>{
    const nextTerm=db.prepare('SELECT id FROM terms WHERE academic_year=? AND name=?').get('2026-2027','下一学期').id;
    const personalBefore=db.prepare('SELECT * FROM timetables ORDER BY id').all();
    const payload=(await inspect([course('工程经济学','SHARED-A','2027-03-01')],{termId:nextTerm})).data;
    const second=await save('下学期模板二',payload,{termId:nextTerm});assert.equal(second.status,201);assert.equal(second.data.created,0);assert.equal(second.data.reused,1);
    const repeatedName=await save('模板一',payload,{termId:nextTerm});assert.equal(repeatedName.status,201);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM timetable_templates WHERE term_id=?').get(nextTerm).n,3);
    assert.deepEqual(db.prepare('SELECT * FROM timetables ORDER BY id').all(),personalBefore);
    assert.ok(db.prepare('SELECT COUNT(*) n FROM timetable_templates JOIN terms ON terms.id=term_id WHERE academic_year=?').get('2026-2027').n>3);
  });
  await t.test('管理员单独手动添加卡片，发布后学生可选且自动生成模板复用它',async()=>{
    const manual={course_name:'手动卡片课程',teacher:'手动老师',teaching_class_code:'MANUAL-ONLY',explicit_sessions:[{date:'2026-11-27',start_time:'11:00',end_time:'12:00',room:'手动教室'},{date:'2026-11-28',start_time:'13:00',end_time:'14:00',room:'手动教室'}]};
    const body={termId,source:'manual',courses:[manual],generateCards:true,published:false,acceptWarnings:true};
    assert.equal((await call('/admin/timetable/courses','POST',body)).status,401);
    assert.equal((await call('/admin/timetable/courses','POST',body,student)).status,403);
    const created=await call('/admin/timetable/courses','POST',body,admin);assert.equal(created.status,201);assert.equal(created.data.created,1);assert.equal(created.data.cardsCreated,1);
    let card=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data.find(c=>c.teaching_class_code==='MANUAL-ONLY');assert.equal(card.published,false);
    assert.deepEqual(card.sessions.map(s=>s.start_time+'-'+s.end_time),['11:00-12:00','13:00-14:00']);
    assert.ok(!(await call('/timetable/cards?termId='+termId,'GET',undefined,student)).data.some(c=>c.id===card.id));
    const before=db.prepare('SELECT COUNT(*) n FROM public_courses').get().n;
    const duplicate=await call('/admin/timetable/courses','POST',body,admin);assert.equal(duplicate.status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,before);
    assert.equal((await call('/admin/timetable/courses/'+card.id,'PUT',{course:manual,revision:card.revision,cardEnabled:true,published:true,acceptWarnings:true},admin)).status,200);
    const available=(await call('/timetable/cards?termId='+termId,'GET',undefined,student)).data.find(c=>c.id===card.id);assert.equal(available.sessions[0].start_time,'11:00');assert.equal(available.sessions[0].end_time,'12:00');
    const current=(await call('/timetable/'+termId,'GET',undefined,student)).data;
    const selected=await call('/timetable/'+termId,'POST',{source:'cards',courseIds:[card.id],revision:current.timetable.revision,acceptWarnings:true},student);assert.equal(selected.status,200);assert.ok(selected.data.courses.some(c=>c.publicCourseId===card.id));
    const p=(await inspect([manual])).data;assert.equal(p.stats.reusedCourses,1);assert.equal(p.stats.newCourses,0);
    const template=await save('手动卡片组成的模板',p);assert.equal(template.status,201);assert.equal(template.data.created,0);assert.equal(template.data.reused,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,before);
  });

});
