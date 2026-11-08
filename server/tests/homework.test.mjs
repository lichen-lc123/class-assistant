import {courseTarget} from './fixtures/course-target.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {homeworkFromFile,parseHomeworkDeadline} from '../homework-files.mjs';
import {compareHomework} from '../homework.mjs';
const term={academicYear:'2026-2027',name:'秋冬学期',startsOn:'2026-09-01',endsOn:'2027-01-31'};
function zip(files){const parts=[],central=[];let offset=0;for(const [name,content]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(content),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);parts.push(head,n,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=30+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const c=(ref,text)=>`<c r="${ref}" t="inlineStr"><is><t>${escape(text)}</t></is></c>`;
const row=(r,values)=>`<row r="${r}">${values.map(([col,value])=>c(col+r,value)).join('')}</row>`;
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const imageId=createHash('sha256').update(image).digest('hex');
function fixture(){
  const header=row(2,[['A','序号'],['B','课程名称'],['C','学分'],['D','任课老师'],['E','第一次作业内容'],['F','截止日期'],['G','提交平台'],['H','课程考核规则'],['I','是否需要组队'],['J','备注']]);
  const xml=`<worksheet><sheetData>${header}${row(3,[['B','工程经济学'],['D','甲老师'],['E','阅读第一章'],['F','11月 13 日晚 22：00 前'],['G','学习平台'],['H','平时成绩占40%']])}<row r="4"><c r="A4"/><c r="C4"/><c r="D4"/><c r="E4"><f>DISPIMG("ID_HOMEWORK",1)</f></c></row>${row(5,[['B','工程经济学'],['D','乙老师'],['E','无'],['H','期末占60%']])}</sheetData><mergeCells><mergeCell ref="B3:B4"/><mergeCell ref="D3:D4"/></mergeCells></worksheet>`;
  return{name:'作业测试.xlsx',content:zip({'xl/workbook.xml':'<workbook><sheets><sheet name="第一次课" r:id="rId1"/><sheet name="秋冬校历" r:id="rId2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>','xl/worksheets/sheet1.xml':xml,'xl/worksheets/sheet2.xml':'<worksheet/>','xl/cellimages.xml':'<cellImages><etc:pic><xdr:cNvPr name="ID_HOMEWORK"/><a:blip r:embed="rImage"/></etc:pic></cellImages>','xl/_rels/cellimages.xml.rels':'<Relationships><Relationship Id="rImage" Target="media/image1.png"/></Relationships>','xl/media/image1.png':image}).toString('base64')};
}
test('作业表解析保留合并单元格、空单元格后的图片与不同老师的考核，空白及无不生成作业',()=>{
  const result=homeworkFromFile(fixture(),term);assert.equal(result.records.length,3);assert.equal(result.records.filter(r=>r.kind==='assignment').length,1);assert.equal(result.assets.length,1);assert.equal(result.assets[0].id,imageId);assert.deepEqual(result.sheets,['第一次课']);assert.deepEqual(result.ignoredSheets,['秋冬校历']);
  const work=result.records.find(r=>r.kind==='assignment');assert.equal(work.teacher,'甲老师');assert.equal(work.content,'阅读第一章');assert.equal(work.due_date,'2026-11-13');assert.equal(work.due_time,'22:00');assert.equal(work.attachments[0].field,'content');assert.equal(work.source_rows.length,2);assert.ok(!result.records.find(r=>r.teacher==='乙老师').assessment_rules.includes('40%'));
});
const secondImage=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function floatingFixture({firstContent='',assessment=false,unbound=false,external=false}={}){
  const files={'xl/workbook.xml':'<workbook><sheets><sheet name="图片作业甲" r:id="r1"/><sheet name="图片作业乙" r:id="r2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>','xl/media/image1.png':image,'xl/media/image2.png':secondImage};
  for(const i of [1,2]){
    const header=row(2,[['B','课程名称'],['D','任课老师'],['E','浮动作业内容'],['F','截止日期'],['H','课程考核规则']]);
    files['xl/worksheets/sheet'+i+'.xml']='<worksheet><sheetData>'+header+row(3,[['B',i===1?'工程经济学':'系统工程'],['D',i===1?'甲老师':'浮图老师'],['E',i===1?firstContent:''],['F','11月13日 22:00']])+'</sheetData><drawing r:id="rDrawing"/></worksheet>';
    files['xl/worksheets/_rels/sheet'+i+'.xml.rels']='<Relationships><Relationship Id="rDrawing" Target="../drawings/drawing'+i+'.xml"/></Relationships>';
    const pic='<xdr:pic><xdr:cNvPr name="Picture 1"/><a:blip '+(external&&i===1?'r:link':'r:embed')+'="rImage"/></xdr:pic>';
    const anchor=(col,kind='oneCellAnchor')=>'<xdr:'+kind+'><xdr:from><xdr:col>'+col+'</xdr:col><xdr:row>2</xdr:row></xdr:from>'+pic+'</xdr:'+kind+'>';
    files['xl/drawings/drawing'+i+'.xml']='<xdr:wsDr>'+(unbound&&i===1?'<xdr:absoluteAnchor>'+pic+'</xdr:absoluteAnchor>':anchor(4,i===1?'oneCellAnchor':'twoCellAnchor'))+(assessment&&i===1?anchor(7):'')+'</xdr:wsDr>';
    files['xl/drawings/_rels/drawing'+i+'.xml.rels']='<Relationships><Relationship Id="rImage" '+(external&&i===1?'TargetMode="External" Target="https://example.invalid/image.png"':'Target="../media/image'+i+'.png"')+'/></Relationships>';
  }
  return{name:'浮动图片.xlsx',content:zip(files).toString('base64')};
}
test('Excel浮动图片按工作表及锚点归入正文或考核，同名图片不串课程',()=>{
  const result=homeworkFromFile(floatingFixture({assessment:true}),term),work=result.records.filter(r=>r.kind==='assignment');assert.equal(work.length,2);assert.equal(result.assets.length,2);
  const a=work.find(r=>r.teacher==='甲老师'),b=work.find(r=>r.teacher==='浮图老师');assert.equal(a.content,'');assert.equal(a.attachments[0].field,'content');assert.equal(a.attachments[0].assetId,imageId);assert.equal(b.attachments[0].assetId,createHash('sha256').update(secondImage).digest('hex'));assert.equal(a.due_time,'22:00');
  const policy=result.records.find(r=>r.kind==='reference');assert.equal(policy.attachments[0].field,'assessment_rules');assert.equal(policy.attachments[0].assetId,imageId);assert.deepEqual(Buffer.from(result.assets.find(a=>a.id===imageId).content,'base64'),image);
});
test('作业内容明确为无时不生成作业卡片，空白图片单元格仍生成图片作业',()=>{
  for(const text of ['无',' 无。 ','无作业','—']){const result=homeworkFromFile(floatingFixture({firstContent:text}),term);assert.equal(result.records.filter(r=>r.kind==='assignment').length,1);assert.equal(result.records.find(r=>r.kind==='assignment').teacher,'浮图老师');assert.ok(result.warnings.some(w=>w.includes('未归入有效作业字段')));}
});
test('无单元格锚点或外部链接图片明确提示，不猜课程归属或下载外链',()=>{
  const unbound=homeworkFromFile(floatingFixture({unbound:true}),term);assert.equal(unbound.records.filter(r=>r.kind==='assignment').length,1);assert.ok(unbound.warnings.some(w=>w.includes('未绑定单元格')));
  const external=homeworkFromFile(floatingFixture({external:true}),term);assert.equal(external.assets.length,1);assert.ok(external.warnings.some(w=>w.includes('无法提取的图片')));assert.ok(external.records.find(r=>r.teacher==='甲老师').content.includes('图片待补充'));
});

test('截止说明跨年推断、日期无时刻和逾期规则保留；歧义日期不编造',()=>{
  assert.equal(parseHomeworkDeadline('1月10日',term).due_date,'2027-01-10');assert.equal(parseHomeworkDeadline('1月10日',term).due_time,null);
  const late=parseHomeworkDeadline('2026.11.8前，延迟会扣分，最晚11.15前',term);assert.equal(late.due_date,'2026-11-08');assert.ok(late.deadline_raw.includes('最晚11.15'));assert.ok(late.warnings.some(w=>w.includes('扣分')));
  const unknown=parseHomeworkDeadline('待通知 23:59',{...term,startsOn:null,endsOn:null});assert.equal(unknown.due_date,null);assert.equal(unknown.due_time,null);assert.throws(()=>parseHomeworkDeadline('2026.2.30 23:59',term),/日期/);
  assert.throws(()=>homeworkFromFile({name:'旧.xls',content:'AA=='},term),/XLSX/);
});
test('英语表同一行的两班中期作业按说明中的老师分配，不按物理行误分',()=>{
  const xml=`<worksheet><sheetData>${row(2,[['A','课次'],['B','任课老师'],['C','作业内容'],['D','截止时间'],['E','提交平台'],['F','备注'],['G','中期作业（演讲视频）'],['H','中期作业（演讲视频）'],['I','课程考核规则']])}${row(3,[['A','第一次课'],['B','甲老师'],['C','完成U1'],['D','9月27日 23:59'],['G','甲老师班级：视频甲\n提交截止时间：10月11日 23:59'],['H','乙老师班级：视频乙\n提交截止时间：10月11日 23:59']])}${row(4,[['B','乙老师']])}</sheetData><mergeCells><mergeCell ref="A3:A4"/><mergeCell ref="C3:C4"/><mergeCell ref="D3:D4"/></mergeCells></worksheet>`;
  const file={name:'英语.xlsx',content:zip({'xl/workbook.xml':'<workbook><sheets><sheet name="英语秋季课程" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':xml}).toString('base64')};
  const records=homeworkFromFile(file,term).records.filter(r=>r.kind==='assignment');assert.equal(records.length,4);const mid=records.filter(r=>r.title.includes('中期'));assert.equal(mid.length,2);assert.ok(mid.find(r=>r.teacher==='乙老师').content.includes('视频乙'));assert.ok(!mid.find(r=>r.teacher==='甲老师').content.includes('视频乙'));assert.equal(mid[0].due_date,'2026-10-11');
});
test('默认按学委截止时间正序，个人优先级先于计划时间，未知截止排后',()=>{
  const records=[{id:'a',title:'默认晚',due_date:'2026-11-13'},{id:'b',title:'默认早',due_date:'2026-11-08'},{id:'c',title:'高优先晚计划',priority:'high',planned_date:'2027-01-01',due_date:'2026-12-01'},{id:'d',title:'个人早计划',planned_date:'2026-11-01',due_date:'2026-12-01'},{id:'e',title:'低优先早截止',priority:'low',due_date:'2026-10-01'},{id:'f',title:'未知截止'}];
  assert.deepEqual(records.sort(compareHomework).map(r=>r.id),['c','d','b','a','f','e']);
});

test('已完成作业按完成时间倒序，优先级和计划时间不干扰，缺失时间排后',()=>{
  const records=[
    {id:'old',title:'旧完成',completed:true,completedAt:'2026-11-06T12:00:00.000Z',priority:'high',planned_date:'2026-11-01'},
    {id:'new',title:'最新完成',completed:true,completedAt:'2026-11-07T12:00:00.000Z',priority:'low',planned_date:'2027-01-01'},
    {id:'pending',title:'尚未完成',completed:false,priority:'low'},
    {id:'unknown',title:'缺失完成时间',completed:true,completedAt:null},
    {id:'middle',title:'中间完成',completed:true,completedAt:'2026-11-07T08:00:00.000Z'},
  ];
  assert.deepEqual(records.sort(compareHomework).map(r=>r.id),['pending','new','middle','old','unknown']);
  const tied=[{id:'b',title:'同名',completed:true,completedAt:null},{id:'a',title:'同名',completed:true,completedAt:null}];
  assert.deepEqual(tied.sort(compareHomework).map(r=>r.id),['a','b']);
});
test('作业完整流程：管理员预览确认、草稿、班级隔离、附件授权、个人完成和版本保护',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'work-admin','学委','HomeworkAdmin123');const pass=await hashPassword('HomeworkStudent123');for(const id of ['work-one','work-two','work-peer'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,pass);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'work-admin',password:'HomeworkAdmin123'})).cookie,one=(await call('/auth/login','POST',{studentId:'work-one',password:'HomeworkStudent123'})).cookie,two=(await call('/auth/login','POST',{studentId:'work-two',password:'HomeworkStudent123'})).cookie;
  const peer=(await call('/auth/login','POST',{studentId:'work-peer',password:'HomeworkStudent123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',term,admin)).data.id;
  for(const [cookie,code,teacher]of [[one,'CLASS-A','甲老师'],[two,'CLASS-B','乙老师'],[peer,'CLASS-A','甲老师']]){const r=await call('/timetable/'+termId,'POST',{source:'ai',acceptWarnings:true,courses:[{course_name:'工程经济学',teacher,teaching_class_code:code,explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}]},cookie);assert.equal(r.status,200);}
  assert.equal((await call('/homework')).status,401);assert.equal((await call('/admin/homework?termId='+termId,'GET',undefined,one)).status,403);
  const p=await call('/admin/homework/preview','POST',{termId,file:fixture()},admin);assert.equal(p.status,200);assert.equal(db.prepare('SELECT count(*) n FROM homework_records').get().n,0);assert.deepEqual(p.data.records.find(r=>r.kind==='assignment').targetKeys,[courseTarget(db,'CLASS-A')]);
  const payload={termId,records:p.data.records,assets:p.data.assets};assert.equal((await call('/admin/homework/import','POST',payload,admin)).status,400);
  const ambiguous=(await call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[{course_name:'工程经济学',teacher:'甲老师',teaching_class_code:'CLASS-C'}],acceptWarnings:true,generateCards:false},admin));assert.equal(ambiguous.status,201);
  const ambiguousPreview=(await call('/admin/homework/preview','POST',{termId,file:fixture()},admin)).data;assert.equal(ambiguousPreview.records.find(r=>r.kind==='assignment').matchCount,2);assert.equal(ambiguousPreview.records.find(r=>r.kind==='assignment').published,false);assert.deepEqual(ambiguousPreview.records.find(r=>r.kind==='assignment').targetKeys,[]);
  const saved=await call('/admin/homework/import','POST',{...payload,confirm:true},admin);assert.equal(saved.status,201);assert.equal(saved.data.created,3);assert.equal(saved.data.drafts,0);
  const repeat=await call('/admin/homework/import','POST',{...payload,confirm:true},admin);assert.equal(repeat.data.created,0);assert.equal(repeat.data.skipped,3);
  const mine=(await call('/homework?userId=work-two','GET',undefined,one)).data.records,others=(await call('/homework','GET',undefined,two)).data.records;assert.equal(mine.length,2);assert.equal(others.length,1);assert.ok(mine.every(r=>r.teacher==='甲老师'));assert.ok(others.every(r=>r.teacher==='乙老师'));assert.ok(!JSON.stringify(mine).includes('source_rows'));assert.equal((await call('/homework','GET',undefined,admin)).data.records.length,0);
  let work=mine.find(r=>r.kind==='assignment');const imageUrl=work.attachments[0].url;
  assert.equal((await fetch(base+imageUrl,{headers:{Cookie:one}})).status,200);assert.equal((await fetch(base+imageUrl,{headers:{Cookie:two}})).status,403);
  assert.equal((await call(`/homework/records/${work.id}/completion`,'POST',{revision:work.revision,completed:true},two)).status,403);
  assert.equal((await call(`/homework/records/${work.id}/completion`,'POST',{revision:work.revision,completed:true},one)).data.completed,true);
  assert.equal((await call('/homework/summary','GET',undefined,one)).data.pendingCount,0);
  const original=(await call('/admin/homework?termId='+termId,'GET',undefined,admin)).data.records.find(r=>r.id===work.id);
  const edited=await call('/admin/homework/records/'+work.id,'PUT',{revision:original.revision,record:{...original,content:'内容已更新',targetKeys:original.targets.map(t=>t.key)}},admin);assert.equal(edited.status,200);assert.equal(edited.data.revision,2);
  assert.equal((await call(`/homework/records/${work.id}/completion`,'POST',{revision:1,completed:true},one)).status,409);
  work=(await call('/homework','GET',undefined,one)).data.records.find(r=>r.id===work.id);assert.equal(work.completed,false);assert.equal(work.needsReconfirm,true);assert.equal((await call('/homework/summary','GET',undefined,one)).data.pendingCount,1);
  const draft={...payload.records.find(r=>r.kind==='assignment'),title:'未确认班级作业',published:false,targetKeys:[]};const create=await call('/admin/homework/records','POST',{termId,record:draft,assets:p.data.assets},admin);assert.equal(create.status,201);assert.ok(!(await call('/homework','GET',undefined,one)).data.records.some(r=>r.title===draft.title));
  const future=await call('/admin/homework/records','POST',{termId,record:{...draft,title:'废弃班号不再发布',targetKeys:['code:FUTURE-CLASS'],published:true}},admin);assert.equal(future.status,400);
  for(const [title,due]of [['较早作业','2026-11-08'],['其次作业','2026-11-09'],['第三作业','2026-11-10']])assert.equal((await call('/admin/homework/records','POST',{termId,record:{...draft,attachments:[],title,due_date:due,due_time:'23:59',deadline_raw:due+' 23:59',targetKeys:[courseTarget(db,'CLASS-A')],published:true}},admin)).status,201);
  assert.deepEqual((await call('/homework/summary','GET',undefined,one)).data.records.map(r=>r.title),['较早作业','其次作业','第三作业',work.title]);
  const preferences={revision:work.revision,priority:'high',planned_date:'2026-12-01',planned_time:'18:00'};
  assert.equal((await call(`/homework/records/${work.id}/preferences`,'PUT',preferences,two)).status,403);
  const ownPlan=await call(`/homework/records/${work.id}/preferences`,'PUT',preferences,one);assert.equal(ownPlan.status,200);assert.equal(ownPlan.data.due_date,'2026-11-13');assert.equal(ownPlan.data.due_time,'22:00');assert.equal(ownPlan.data.priority,'high');assert.equal(ownPlan.data.planned_date,'2026-12-01');assert.equal(ownPlan.data.deadline_raw,'11月 13 日晚 22：00 前');
  const peerWork=(await call('/homework','GET',undefined,peer)).data.records.find(r=>r.id===work.id);assert.equal(peerWork.priority,'normal');assert.equal(peerWork.planned_date,null);assert.equal(peerWork.completed,false);
  assert.equal((await call('/homework/summary','GET',undefined,one)).data.records[0].id,work.id);assert.equal((await call(`/homework/records/${work.id}/preferences`,'PUT',{...preferences,revision:1},one)).status,409);assert.equal((await call(`/homework/records/${work.id}/preferences`,'PUT',{...preferences,planned_date:'2026-02-30'},one)).status,400);
  const early=(await call('/homework','GET',undefined,one)).data.records.find(r=>r.title==='第三作业');assert.equal((await call(`/homework/records/${early.id}/preferences`,'PUT',{revision:early.revision,priority:'normal',planned_date:'2026-11-01'},one)).status,200);assert.deepEqual((await call('/homework/summary','GET',undefined,one)).data.records.map(r=>r.title),[work.title,'第三作业','较早作业','其次作业']);
  const publicData=JSON.parse(db.prepare('SELECT payload_json FROM homework_records WHERE id=?').get(work.id).payload_json);assert.equal(publicData.due_date,'2026-11-13');assert.equal(publicData.planned_date,undefined);assert.equal(publicData.priority,undefined);
  assert.equal((await call(`/homework/records/${work.id}/preferences`,'PUT',{revision:work.revision,priority:'normal',planned_date:null,planned_time:null},one)).status,200);assert.equal((await call('/homework/summary','GET',undefined,one)).data.records[0].title,'第三作业');
  assert.equal((await call('/admin/homework/records','POST',{termId,record:{...draft,title:'错误发布',published:true}},admin)).status,400);
  const missing={...draft,title:'图片缺失',attachments:[{assetId:'0'.repeat(64),field:'content',caption:'缺失'}]};assert.equal((await call('/admin/homework/records','POST',{termId,record:missing},admin)).status,400);assert.equal(db.prepare("SELECT count(*) n FROM homework_records WHERE title='图片缺失'").get().n,0);
  assert.equal((await call('/admin/homework/records/'+work.id,'DELETE',{revision:1,confirm:true},admin)).status,409);assert.equal((await call('/admin/homework/records/'+work.id,'DELETE',{revision:2,confirm:true},admin)).status,200);assert.equal((await fetch(base+imageUrl,{headers:{Cookie:one}})).status,404);
  const floating=(await call('/admin/homework/preview','POST',{termId,file:floatingFixture()},admin)).data;
  const imageWork=floating.records.find(r=>r.kind==='assignment'&&r.teacher==='甲老师');
  const savedImage=await call('/admin/homework/import','POST',{termId,records:[{...imageWork,targetKeys:[courseTarget(db,'CLASS-A')],published:true}],assets:floating.assets,confirm:true},admin);assert.equal(savedImage.status,201);assert.equal(savedImage.data.created,1);
  const visibleImage=(await call('/homework','GET',undefined,one)).data.records.find(r=>r.title===imageWork.title);assert.equal(visibleImage.content,'');assert.equal(visibleImage.attachments[0].field,'content');
  const picture=await fetch(base+visibleImage.attachments[0].url,{headers:{Cookie:one}});assert.equal(picture.status,200);assert.deepEqual(Buffer.from(await picture.arrayBuffer()),image);
  assert.equal((await fetch(base+visibleImage.attachments[0].url,{headers:{Cookie:two}})).status,403);
  const countBefore=db.prepare('SELECT count(*) n FROM homework_records').get().n;
  const noAssignment=await call('/admin/homework/import','POST',{termId,records:[{...imageWork,title:'明确无作业',content:' 无。 ',attachments:[],targetKeys:[courseTarget(db,'CLASS-A')],published:true}],confirm:true},admin);assert.equal(noAssignment.status,201);assert.equal(noAssignment.data.created,0);assert.equal(noAssignment.data.skippedEmpty,1);assert.equal(db.prepare('SELECT count(*) n FROM homework_records').get().n,countBefore);

});
