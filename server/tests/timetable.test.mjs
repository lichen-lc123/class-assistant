import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.mjs';
import { createInitialAdmin, hashPassword } from '../database.mjs';
import { normalizeCourse, expandCourse, todayShanghai, validateTerm } from '../schedule.mjs';
import { coursesFromFiles } from '../timetable-files.mjs';

const config={calendars:[{name:'工院秋冬',start_date:'2026-09-14'}],periods:[{number:2,start:'08:50',end:'09:35'},{number:5,start:'11:40',end:'12:25'},{number:6,start:'13:25',end:'14:10'},{number:9,start:'16:15',end:'17:00'}],aliases:['秋','秋学期']};
const term={id:'term',academicYear:'2026-2027',name:'秋学期',startsOn:'2026-09-01',endsOn:'2027-01-31',config};
const raw=(name='工程经济学',code='6041612504')=>({course_name:name,teaching_class_code:code,teacher:'测试老师',room:'工教二307',academic_year:'2026-2027',semester:'秋学期',weekly_rules:[{calendar_name:'工院秋冬',weeks:[5,7,9,11,13,15],weekday:6,period_start:6,period_end:9,room:'工教二307'}],special_dates:[{date:'2027-01-09',lesson_number:7,kind:'supplement'},{date:'2027-01-16',lesson_number:8,kind:'supplement'}]});

test('周次、节次、跨年补课能准确展开；待确认信息不会编造日期',()=>{
  const c=normalizeCourse(raw(),term),r=expandCourse(c,term);
  assert.equal(r.sessions.length,8);assert.equal(r.sessions[0].date,'2026-10-17');assert.equal(r.sessions[1].date,'2026-10-31');assert.equal(r.sessions[0].start_time,'13:25');assert.equal(r.sessions.at(-1).date,'2027-01-16');
  const missing=expandCourse(c,{...term,config:{periods:[],calendars:[]}});assert.equal(missing.sessions.length,0);assert.ok(missing.warnings.some(w=>w.includes('待确认')));
  const english=expandCourse(normalizeCourse({course_name:'英语',weekly_rules:[]},term),term);assert.equal(english.schedule_status,'pending');
  assert.throws(()=>normalizeCourse({...raw(),semester:'冬学期'},term),/学期/);
  assert.throws(()=>normalizeCourse({...raw(),special_dates:[{date:'2026-02-30'}]},term),/日期/);
});
test('实践替换当日教室课程；未知备注不会静默覆盖',()=>{
  const c=normalizeCourse({...raw('理论实践'),weekly_rules:[{calendar_name:'工院秋冬',weeks:[9],weekday:7,period_start:2,period_end:5,room:'旧教室'}],special_dates:[{date:'2026-11-15',kind:'practice'}]},term);
  const r=expandCourse(c,term);assert.equal(r.sessions.length,1);assert.equal(r.sessions[0].room,null);assert.equal(r.sessions[0].kind,'practice');
  const unknown=expandCourse(normalizeCourse({...raw(),special_dates:[{date:'2026-11-15',kind:'unknown'}]},term),term);assert.equal(unknown.sessions.length,7);assert.ok(unknown.sessions.some(s=>s.date==='2026-11-15'&&s.kind==='unknown'));assert.ok(unknown.warnings.some(w=>w.includes('类型待确认')));
});
test('北京时间跨日与学期配置校验',()=>{
  assert.equal(todayShanghai(new Date('2026-11-01T16:01:00Z')),'2026-11-02');
  assert.throws(()=>validateTerm({academicYear:'2026-2027',name:'秋',startsOn:'2026-11-02',endsOn:'2026-10-01'}),/范围/);
  assert.throws(()=>validateTerm({academicYear:'2026-2027',name:'秋',config:{periods:[{number:1,start:'09:00',end:'08:00'}]}}),/节次/);
});

// Small stored ZIP test fixture; no external Excel/ZIP dependency or file writes.
function zip(files){const parts=[],central=[];let offset=0;for(const [name,content]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(content),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);parts.push(head,n,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=30+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
test('XLSX 解析保留缺失周次及原表标签，拒绝损坏文件',()=>{
  const xml='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>课程名称</t></is></c><c r="B1" t="inlineStr"><is><t>上课时间</t></is></c><c r="C1" t="inlineStr"><is><t>学期</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>工程经济学</t></is></c><c r="B2" t="inlineStr"><is><t>星期六 第6-9节</t></is></c><c r="C2" t="inlineStr"><is><t>秋学期</t></is></c></row></sheetData></worksheet>';
  const b=zip({'xl/workbook.xml':'<workbook><sheets><sheet name="课表" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':xml});
  const r=coursesFromFiles([{name:'课程.xlsx',content:b.toString('base64')}],term);assert.equal(r.courses.length,1);assert.deepEqual(r.courses[0].weekly_rules[0].weeks,[]);assert.equal(r.courses[0].weekly_rules[0].period_start,6);
  assert.throws(()=>coursesFromFiles([{name:'坏文件.xls',content:Buffer.from('bad').toString('base64')}],term),/真正/);
  const merged=coursesFromFiles([{name:'课表.xlsx',content:b.toString('base64')}],{...term,name:'第一学期',config:{...config,aliases:[]}});assert.equal(merged.courses[0].semester,'第一学期');assert.deepEqual(merged.courses[0].extra_fields['原表标注'],['秋学期']);
});

function combinedWorkbook(label,rows,year='2026-2027'){
  const headers=['课程名称','学期','学年','任课老师','上课时间地点','备注'];
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const data=[headers,...rows.map(row=>[row[0],label,year,'同一老师',row[1],row[2]||''])];
  const xml='<worksheet><sheetData>'+data.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')+'</sheetData></worksheet>';
  return {name:label+'.xlsx',content:zip({'xl/workbook.xml':'<workbook><sheets><sheet name="课表" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':xml}).toString('base64')};
}
const combinedTerm={academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-14',endsOn:'2027-01-15',config:{aliases:[],calendars:[{name:'原文周历甲',start_date:'2026-11-09',end_date:'2027-01-01'}],periods:[{number:6,start:'13:25',end:'14:10'},{number:9,start:'16:15',end:'17:00'}]}};
const combinedFiles=()=>[
  combinedWorkbook('秋学季',[['共同课程','班级编号SHARED\n原文周历甲(第5,7周)//星期五//6-9节//教室甲','第7、8次课在1月16日、1月23日'],['另一门课程','班级编号OTHER\n时间地点待通知']]),
  combinedWorkbook('冬学季',[['共同课程','班级编号SHARED\n原文周历甲(第5,7周)//星期五//6-9节//教室甲','第7、8次课在1月16日、1月23日'],['第二份的课程','班级编号SECOND\n时间地点待通知']])
];
test('两份Excel的原表标签不分类，跨范围日期按正确年份保留',()=>{
  const parsed=coursesFromFiles(combinedFiles(),combinedTerm);
  assert.equal(parsed.courses.length,4);assert.ok(parsed.courses.every(c=>c.semester==='第一学期'));
  assert.deepEqual(parsed.courses[0].special_dates.map(s=>[s.date,s.lesson_number]),[['2027-01-16',7],['2027-01-23',8]]);
  assert.deepEqual(parsed.courses[2].extra_fields['原表标注'],['冬学季']);assert.ok(!Object.hasOwn(parsed.courses[0],'seasons'));
  const dates=coursesFromFiles([combinedWorkbook('原表标签',[['日期课程','班级编号DATES','2027年1月30日；2027-02-06；6-9节，4-5人；上课时间为12.11、12.25、1.8、1.15']])],combinedTerm).courses[0].special_dates;
  assert.deepEqual(dates.map(s=>s.date),['2027-01-30','2027-02-06','2026-12-11','2026-12-25','2027-01-08','2027-01-15']);
  const ambiguous=coursesFromFiles([combinedWorkbook('未知年份',[['日期课程','班级编号DATES','1.16']])],{...combinedTerm,startsOn:null,endsOn:null}).courses[0];assert.equal(ambiguous.special_dates[0].date,null);
});
test('Excel学年校验覆盖第二个文件、行内学年和原始课程时间',()=>{
  assert.throws(()=>coursesFromFiles([combinedFiles()[0],combinedWorkbook('第二个文件',[['错误课程','班级编号BAD']],'2025-2026')],combinedTerm),/不属于所选学年/);
  assert.throws(()=>coursesFromFiles([combinedWorkbook('来源',[['错误课程','2025-2026学年秋学季\n班级编号BAD']])],combinedTerm),/不属于所选学年/);
});
test('学生课表和管理员模板均可合并两份Excel，重复班级只保存一次',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'merge-admin','学委','MergeAdminFixture123');
  db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('merge-student','同学',await hashPassword('MergeStudentFixture123'));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,cookie){const response=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login',{studentId:'merge-admin',password:'MergeAdminFixture123'})).cookie,student=(await call('/auth/login',{studentId:'merge-student',password:'MergeStudentFixture123'})).cookie;
  const termId=(await call('/admin/timetable/terms',combinedTerm,admin)).data.id;
  const input={termId,source:'excel',files:combinedFiles()};
  const preview=await call('/timetable/preview',input,student);assert.equal(preview.status,200);assert.equal(preview.data.courses.length,3);
  const shared=preview.data.courses.find(c=>c.teaching_class_code==='SHARED');assert.equal(shared.source_rows.length,2);assert.ok(shared.source_rows.some(s=>s.source.includes('冬学季.xlsx')));
  assert.deepEqual(shared.sessions.map(s=>s.date),['2026-12-11','2026-12-25','2027-01-16','2027-01-23']);assert.equal(preview.data.courses.find(c=>c.teaching_class_code==='SECOND').schedule_status,'pending');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM timetables').get().n,0);
  const saved=await call('/timetable/'+termId,{source:'excel',courses:preview.data.courses,acceptWarnings:true},student);assert.equal(saved.status,200);assert.equal(saved.data.courses.length,3);assert.equal(saved.data.courses.find(c=>c.teaching_class_code==='SHARED').sessions.length,4);
  const template=await call('/admin/timetable/template-preview',input,admin);assert.equal(template.status,200);assert.equal(template.data.courses.length,3);
  const published=await call('/admin/timetable/template-import',{termId,source:'excel',name:'双表合并模板',courses:template.data.courses,catalogVersion:template.data.catalogVersion,acceptWarnings:true},admin);assert.equal(published.status,201);assert.equal(published.data.cardsCreated,3);
  const count=db.prepare('SELECT COUNT(*) n FROM public_courses').get().n;
  const invalid=await call('/admin/timetable/template-preview',{...input,files:[input.files[0],combinedWorkbook('错学年',[['错误','班级编号BAD']],'2025-2026')]},admin);assert.equal(invalid.status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_courses').get().n,count);
});

test('课表完整接口与权限流程',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'fixture-admin','管理员','FixtureAdmin123');
  const pass=await hashPassword('FixtureStudent123');
  for(const id of ['student-one','student-two'])db.prepare('INSERT INTO users (student_id,name,password_hash,must_change_password) VALUES (?,?,?,0)').run(id,id,pass);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'fixture-admin',password:'FixtureAdmin123'})).cookie;
  const student=(await call('/auth/login','POST',{studentId:'student-one',password:'FixtureStudent123'})).cookie;
  const other=(await call('/auth/login','POST',{studentId:'student-two',password:'FixtureStudent123'})).cookie;
  let termId,winterId,courseA,courseB,templateId,own;
  await t.test('只有管理员能配置学期；学期按学年隔离',async()=>{
    assert.equal((await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'秋学期'},student)).status,403);
    const r=await call('/admin/timetable/terms','POST',{...term},admin);assert.equal(r.status,201);termId=r.data.id;
    assert.equal((await call(`/admin/timetable/terms/${termId}`,'PUT',{...term,name:'学生试图改名',revision:r.data.revision},student)).status,403);
    const configured=(await call('/timetable/terms','GET',undefined,student)).data.terms.find(t=>t.id===termId);assert.equal(configured.name,term.name);assert.deepEqual(configured.config,term.config);
    const w=await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'冬学期',startsOn:'2027-02-01',endsOn:'2027-06-30'},admin);assert.equal(w.status,201);winterId=w.data.id;
    assert.equal((await call('/timetable/terms','GET',undefined,student)).data.terms.length,2);
  });
  await t.test('管理员兼具学生能力，个人课表独立于公共管理和他人数据',async()=>{
    assert.equal((await call(`/timetable/${termId}`,'GET',undefined,student)).status,200);
    assert.equal((await call(`/timetable/${termId}`,'GET',undefined,admin)).status,200);
    assert.equal((await call('/timetable/preview','POST',{termId,source:'ai',courses:[raw()]},admin)).status,200);
    const personal=await call(`/timetable/${termId}`,'POST',{source:'ai',courses:[raw()],acceptWarnings:true},admin);assert.equal(personal.status,200);assert.equal(personal.data.courses.length,1);
    assert.equal((await call(`/timetable/${termId}`,'GET',undefined,student)).data.timetable,null);
    assert.equal((await call(`/timetable/${termId}/entries/${personal.data.courses[0].id}`,'DELETE',{revision:personal.data.timetable.revision},student)).status,404);
    assert.equal((await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin)).data.length,0);
    assert.equal((await call(`/timetable/${termId}`,'DELETE',{confirm:true,revision:personal.data.timetable.revision},admin)).status,200);
    assert.equal((await call('/timetable/prompt','GET',undefined,admin)).status,200);
    assert.equal((await call('/admin/timetable/preview','POST',{termId,source:'manual',courses:[raw()]},admin)).status,200);
    assert.equal((await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,student)).status,403);
  });
  await t.test('网站提供外部 AI 提示词；不接收错误 JSON 或跨学期资料',async()=>{
    assert.ok((await call('/timetable/prompt','GET',undefined,student)).data.text.includes('schema_version'));
    assert.equal((await call('/timetable/preview','POST',{termId,source:'ai',text:'not-json'},student)).status,400);
    assert.equal((await call('/timetable/preview','POST',{termId,source:'ai',text:JSON.stringify({schema_version:'timetable.v1',academic_year:'2025-2026',courses:[raw()]})},student)).status,400);
    assert.equal((await call('/timetable/preview','POST',{termId,source:'ai',text:JSON.stringify({schema_version:'timetable.v1',semester:'冬学期',courses:[raw()]})},student)).status,400);
    const p=await call('/timetable/preview','POST',{termId,source:'ai',text:JSON.stringify({schema_version:'timetable.v1',courses:[raw()]})},student);assert.equal(p.status,200);assert.equal(p.data.courses[0].sessions.length,8);
  });
  await t.test('两步AI导入可查看带标记的安排，预览不保存且不会丢失原始备注',async()=>{
    const value=JSON.stringify({schema_version:'timetable.v1',academic_year:'2026-2027',semester:'秋学期',courses:[{...raw(),remarks_raw:'第7、8次课在1月9日、1月16日',schedule_raw:'学校我的课程整页原文'}]});
    const before=db.prepare('SELECT count(*) AS n FROM timetables').get().n;
    const p=await call('/timetable/preview','POST',{termId,source:'ai',text:'【课表开始】\n'+value+'\n【课表结束】'},student);
    assert.equal(p.status,200);assert.equal(p.data.courses[0].sessions.length,8);assert.equal(p.data.courses[0].sessions.at(-1).date,'2027-01-16');assert.ok(p.data.courses[0].remarks_raw.includes('第7、8次课'));assert.equal(db.prepare('SELECT count(*) AS n FROM timetables').get().n,before);
    assert.equal((await call('/timetable/preview','POST',{termId,source:'ai',text:'【课表开始】\n'+value},student)).status,400);
    assert.ok((await call('/timetable/prompt','GET',undefined,student)).data.text.includes('【课表结束】'));
  });
  await t.test('默认生成卡片；取消后仅保存课程；学生不能生成公共卡片',async()=>{
    assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:[raw()]},student)).status,403);
    const a=await call('/admin/timetable/courses','POST',{termId,courses:[raw()],acceptWarnings:true},admin);assert.equal(a.status,201);assert.equal(a.data.cardsCreated,1);
    const b=await call('/admin/timetable/courses','POST',{termId,courses:[raw('系统工程','system-001')],generateCards:false,acceptWarnings:true},admin);assert.equal(b.status,201);assert.equal(b.data.cardsCreated,0);
    const cards=await call(`/timetable/cards?termId=${termId}`,'GET',undefined,student);assert.equal(cards.data.length,1);courseA=cards.data[0].id;
    const all=await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin);assert.equal(all.data.length,2);courseB=all.data.find(c=>c.course_name==='系统工程').id;
    assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:[raw()],generateCards:false,acceptWarnings:true},admin)).data.created,0);
    assert.equal((await call(`/timetable/cards?termId=${termId}`,'GET',undefined,student)).data.length,1);
  });
  await t.test('模板能使用没有卡片的课程，且成员变动同步到个人课表',async()=>{
    const tpl=await call('/admin/timetable/templates','POST',{termId,name:'模板一',courseIds:[courseA,courseB]},admin);assert.equal(tpl.status,201);templateId=tpl.data.id;
    const p=await call('/timetable/selection-preview','POST',{termId,source:'template',templateId},student);assert.equal(p.status,200);assert.equal(p.data.courses.length,2);assert.ok(p.data.conflicts.length);assert.equal(p.data.importBlocked,true);
    assert.equal((await call(`/timetable/${termId}`,'POST',{source:'template',templateId,acceptWarnings:true},student)).status,409);
    const oldB=(await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin)).data.find(c=>c.id===courseB);
    assert.equal((await call(`/admin/timetable/courses/${courseB}`,'PUT',{course:{...oldB,weekly_rules:[],special_dates:[],explicit_sessions:[{date:'2026-11-20',start_time:'18:00',end_time:'20:00',room:'另一教室'}]},revision:oldB.revision,cardEnabled:false,acceptWarnings:true},admin)).status,200);
    const s=await call(`/timetable/${termId}`,'POST',{source:'template',templateId,revision:0,acceptWarnings:true},student);assert.equal(s.status,200);assert.equal(s.data.courses.length,2);own=s.data;
    const revision=(await call(`/admin/timetable/templates?termId=${termId}`,'GET',undefined,admin)).data[0].revision;
    assert.equal((await call(`/admin/timetable/templates/${templateId}`,'PUT',{name:'模板一新版',courseIds:[courseA],revision},admin)).status,200);
    own=(await call(`/timetable/${termId}`,'GET',undefined,student)).data;assert.equal(own.courses.length,1);assert.equal(own.courses[0].publicCourseId,courseA);
  });
  await t.test('新增导入拒绝重复时段；非卡片课程不能经卡片入口加入',async()=>{
    assert.equal((await call(`/timetable/${termId}`,'POST',{source:'ai',courses:[raw()],revision:own.timetable.revision,acceptWarnings:true},student)).status,409);
    assert.equal((await call(`/timetable/${termId}`,'POST',{source:'cards',courseIds:[courseB],acceptWarnings:true},other)).status,400);
    const empty=(await call(`/timetable/${termId}`,'GET',undefined,other)).data;assert.equal(empty.timetable,null);
  });
  await t.test('包含补课的课程仅改地点时，仍跟随公共时间',async()=>{
    let r=await call(`/timetable/${termId}`,'POST',{source:'cards',courseIds:[courseA],acceptWarnings:true},other);assert.equal(r.status,200);
    const c=r.data.courses[0];assert.equal(c.sessions.length,8);
    const sessions=c.sessions.map(s=>({...s,room:'另一位同学确认地点',kind:s.kind==='practice'?'practice':'lecture'}));
    r=await call(`/timetable/${termId}/entries/${c.id}`,'PATCH',{revision:r.data.timetable.revision,publicRevision:c.publicRevision,sessions},other);assert.equal(r.status,200);
    const stored=JSON.parse(db.prepare('SELECT override_json FROM timetable_entries WHERE id=?').get(c.id).override_json);assert.equal(stored.time_override,null);
  });
  await t.test('个人修改优先，公共更新只影响未覆盖安排；可恢复公共安排',async()=>{
    const entry=own.courses.find(c=>c.publicCourseId===courseA);
    const custom=[{date:'2026-11-02',start_time:'10:00',end_time:'11:00',room:'个人确认地点'}];
    let s=await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions:custom},student);assert.equal(s.status,200);own=s.data;
    const all=(await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin)).data;const master=all.find(c=>c.id===courseA);
    const updated={...master,weekly_rules:[],special_dates:[],explicit_sessions:[{date:'2026-11-03',start_time:'12:00',end_time:'13:00',room:'公共新教室'}]};
    assert.equal((await call(`/admin/timetable/courses/${courseA}`,'PUT',{course:updated,revision:master.revision,acceptWarnings:true},admin)).status,200);
    let view=(await call(`/timetable/${termId}`,'GET',undefined,student)).data;let mine=view.courses.find(c=>c.id===entry.id);assert.equal(mine.sessions[0].date,'2026-11-02');assert.equal(mine.sessions[0].room,'个人确认地点');assert.equal(mine.publicChanged,true);
    s=await call(`/timetable/${termId}/entries/${entry.id}/reset`,'POST',{revision:view.timetable.revision},student);assert.equal(s.status,200);view=s.data;mine=view.courses.find(c=>c.id===entry.id);assert.equal(mine.sessions[0].date,'2026-11-03');assert.equal(mine.hasOverride,false);own=view;
    const otherView=(await call(`/timetable/${termId}`,'GET',undefined,other)).data;assert.equal(otherView.courses[0].sessions[0].date,'2026-11-03');assert.equal(otherView.courses[0].sessions[0].room,'另一位同学确认地点');
  });
  await t.test('不能修改他人课表；旧版本不能覆盖新修改',async()=>{
    const entry=own.courses[0];assert.equal((await call(`/timetable/${termId}/entries/${entry.id}`,'DELETE',{revision:0},other)).status,404);
    assert.equal((await call(`/timetable/${termId}`,'DELETE',{revision:0,confirm:true},student)).status,409);
    assert.ok((await call(`/timetable/${termId}`,'GET',undefined,student)).data.timetable);
  });
  await t.test('仅修改个人地点不冻结公共时间；公共更新期间拒绝旧页面修改',async()=>{
    const entry=own.courses.find(c=>c.publicCourseId===courseA);
    const mine=entry.sessions.map(s=>({...s,room:'仅个人地点'}));
    let r=await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions:mine},student);assert.equal(r.status,200);own=r.data;
    const master=(await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin)).data.find(c=>c.id===courseA);
    await call(`/admin/timetable/courses/${courseA}`,'PUT',{course:{...master,explicit_sessions:[{date:'2026-11-04',start_time:'14:00',end_time:'15:00',room:'公共变更地点'}]},revision:master.revision,acceptWarnings:true},admin);
    const view=(await call(`/timetable/${termId}`,'GET',undefined,student)).data;const c=view.courses.find(c=>c.id===entry.id);
    assert.equal(c.sessions[0].date,'2026-11-04');assert.equal(c.sessions[0].start_time,'14:00');assert.equal(c.sessions[0].room,'仅个人地点');
    r=await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:view.timetable.revision,publicRevision:entry.publicRevision,sessions:mine},student);assert.equal(r.status,409);own=view;
  });
  await t.test('删除只影响本人本学期；删除后可换来源，个人导入不产生公共卡片',async()=>{
    const w=await call(`/timetable/${winterId}`,'POST',{source:'ai',courses:[{course_name:'冬季课程',semester:'冬学期'}],acceptWarnings:true},student);assert.equal(w.status,200);
    const deleted=await call(`/timetable/${termId}`,'DELETE',{revision:own.timetable.revision,confirm:true},student);assert.equal(deleted.status,200);
    assert.ok((await call(`/timetable/${winterId}`,'GET',undefined,student)).data.timetable);
    assert.equal((await call(`/timetable/${termId}`,'GET',undefined,student)).data.timetable,null);
    const imported=await call(`/timetable/${termId}`,'POST',{source:'ai',courses:[raw('私人导入','personal-001')],generateCards:true,acceptWarnings:true},student);assert.equal(imported.status,200);
    assert.equal((await call(`/timetable/cards?termId=${termId}`,'GET',undefined,student)).data.length,1);
    const duplicate=await call(`/timetable/${termId}`,'POST',{source:'ai',courses:[raw('私人导入','personal-001')],revision:imported.data.timetable.revision,acceptWarnings:true},student);assert.equal(duplicate.status,409);assert.match(duplicate.data.message,/课程时间重复/);
  });
  await t.test('卡片去重和选课保存，不触碰公共课程',async()=>{
    const previous=(await call(`/timetable/${termId}`,'GET',undefined,other)).data;
    const s=await call(`/timetable/${termId}`,'POST',{source:'cards',courseIds:[courseA,courseA],revision:previous.timetable.revision,acceptWarnings:true},other);assert.equal(s.status,409);assert.equal(previous.courses.length,1);
    const e=previous.courses[0];assert.equal((await call(`/timetable/${termId}/entries/${e.id}`,'DELETE',{revision:previous.timetable.revision},other)).status,200);
    assert.equal((await call(`/admin/timetable/courses?termId=${termId}`,'GET',undefined,admin)).data.length,2);
    assert.equal((await call(`/timetable/${termId}`,'GET',undefined,other)).data.timetable.source,'cards');
  });
});
