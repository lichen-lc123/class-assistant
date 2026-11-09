import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {createInitialAdmin} from '../database.mjs';
import {homeworkFromFile} from '../homework-files.mjs';
import {compoundStreams,nativePackage,extractEmbeddedFile} from '../embedded-files.mjs';
import {homeworkTextParts,removeLocalFilePaths,safeHomeworkLink} from '../../shared/homework-links.mjs';
const term={startsOn:'2026-09-01',endsOn:'2027-01-31'};
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const zero=s=>Buffer.from(s+'\0');
function native(name,payload){const command=zero('C:\\original\\'+name);const body=Buffer.concat([Buffer.from([2,0]),zero(name),command,Buffer.alloc(4),u32(command.length),command,u32(payload.length),payload,Buffer.alloc(2)]);return Buffer.concat([u32(body.length),body]);}
function cfb(stream,name=String.fromCharCode(1)+'Ole10Native'){
 const mini=stream.length<4096,blocks=Math.ceil((mini?Math.ceil(stream.length/64)*64:stream.length)/512),start=mini?3:2,total=start+blocks;
 const b=Buffer.alloc((total+1)*512),h=b.subarray(0,512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(h);h.writeUInt16LE(0x3e,24);h.writeUInt16LE(3,26);h.writeUInt16LE(0xfffe,28);h.writeUInt16LE(9,30);h.writeUInt16LE(6,32);h.writeUInt32LE(1,44);h.writeUInt32LE(0,48);h.writeUInt32LE(4096,56);h.writeUInt32LE(mini?2:0xfffffffe,60);h.writeUInt32LE(mini?1:0,64);h.writeUInt32LE(0xfffffffe,68);h.fill(0xff,76,512);h.writeUInt32LE(1,76);
 const sector=id=>b.subarray((id+1)*512,(id+2)*512),fat=sector(1);fat.fill(0xff);fat.writeUInt32LE(0xfffffffe,0);fat.writeUInt32LE(0xfffffffd,4);if(mini)fat.writeUInt32LE(0xfffffffe,8);
 for(let i=0;i<blocks;i++)fat.writeUInt32LE(i===blocks-1?0xfffffffe:start+i+1,(start+i)*4);
 const entry=(off,label,type,first,size)=>{const d=sector(0).subarray(off,off+128),n=Buffer.from(label+'\0','utf16le');n.copy(d);d.writeUInt16LE(n.length,64);d[66]=type;d[67]=1;d.writeUInt32LE(0xffffffff,68);d.writeUInt32LE(0xffffffff,72);d.writeUInt32LE(0xffffffff,76);d.writeUInt32LE(first,116);d.writeBigUInt64LE(BigInt(size),120);};
 entry(0,'Root Entry',5,mini?start:0xfffffffe,mini?Math.ceil(stream.length/64)*64:0);entry(128,name,2,mini?0:start,stream.length);
 if(mini){const f=sector(2);f.fill(0xff);for(let i=0;i<Math.ceil(stream.length/64);i++)f.writeUInt32LE(i===Math.ceil(stream.length/64)-1?0xfffffffe:i+1,i*4);}
 stream.copy(b,(start+1)*512);return b;
}
function zip(files){const parts=[],central=[];let offset=0;for(const [name,value]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.isBuffer(value)?value:Buffer.from(value),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);parts.push(head,n,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,6);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=30+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
const cell=(col,row,value)=>'<c r="'+col+row+'" t="inlineStr"><is><t>'+xml(value)+'</t></is></c>';
function fieldWorkbook(col,bytes,progId,{cross=false,none=false}={}){
 const headers=['课程名称','任课老师','第一次作业内容','课程考核规则','提交平台','备注','附件'];
 const point=cross?1:col;
 const anchor='<objectPr><anchor><from><col>'+point+'</col><colOff>'+(cross?900000:0)+'</colOff><row>1</row></from><to><col>'+col+'</col><colOff>950000</colOff><row>2</row></to></anchor></objectPr>';
 const object='<oleObject shapeId="2050" r:id="o1" progId="'+progId+'">'+anchor+'</oleObject>';
 return{name:'WPS字段附件.xlsx',content:zip({
  'xl/workbook.xml':'<workbook><sheets><sheet name="作业" r:id="s1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':'<worksheet><cols><col min="2" max="2" width="13.8"/></cols><sheetData><row r="1">'+headers.map((v,i)=>cell('ABCDEFG'[i],1,v)).join('')+'</row><row r="2">'+cell('A',2,'测试课程0')+cell('B',2,'测试老师')+cell('C',2,none?'无':'')+'</row></sheetData><oleObjects><mc:AlternateContent><mc:Choice>'+object+'</mc:Choice><mc:Fallback><oleObject shapeId="2050" r:id="o1" progId="'+progId+'"/></mc:Fallback></mc:AlternateContent></oleObjects></worksheet>',
  'xl/worksheets/_rels/sheet1.xml.rels':'<Relationships><Relationship Id="o1" Target="../embeddings/oleObject1.bin"/></Relationships>',
  'xl/embeddings/oleObject1.bin':bytes
 }).toString('base64')};
}
function workbook(items,{content='',unbound=false,none=false}={}){
 const entries={'xl/workbook.xml':'<workbook><sheets><sheet name="作业" r:id="s1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>'};
 let rows='<row r="1">'+['课程名称','任课老师','第一次作业内容','截止日期','附件','备注'].map((v,i)=>cell('ABCDEF'[i],1,v)).join('')+'</row>',rels='',objects='',links='';
 for(const [i,item]of items.entries()){
  const row=i+2;rows+='<row r="'+row+'">'+cell('A',row,'测试课程'+i)+cell('B',row,'测试老师')+cell('C',row,none?'无':content)+cell('D',row,'11月13日')+(item.formula?'<c r="E'+row+'"><f>'+xml(item.formula)+'</f></c>':cell('E',row,item.label||''))+'</row>';
  if(item.url){rels+='<Relationship Id="link'+i+'" TargetMode="External" Target="'+xml(item.url)+'"/>';links+='<hyperlink ref="E'+row+'" r:id="link'+i+'"/>';}
  if(item.bytes){const target='xl/embeddings/'+item.name;entries[target]=item.bytes;rels+='<Relationship Id="object'+i+'" Target="../embeddings/'+xml(item.name)+'"/>';objects+='<oleObject r:id="object'+i+'" progId="'+(item.progId||'Package')+'">'+(unbound?'':'<objectPr><anchor><from><col>4</col><row>'+(row-1)+'</row></from></anchor></objectPr>')+'</oleObject>';}
 }
 entries['xl/worksheets/sheet1.xml']='<worksheet><sheetData>'+rows+'</sheetData><hyperlinks>'+links+'</hyperlinks><oleObjects>'+objects+'</oleObjects></worksheet>';entries['xl/worksheets/_rels/sheet1.xml.rels']='<Relationships>'+rels+'</Relationships>';
 return {name:'测试附件.xlsx',content:zip(entries).toString('base64')};
}

test('CFB普通流与小流提取原始文件及中文文件名，隔离电脑路径',()=>{
 for(const length of [20,5000]){const bytes=Buffer.alloc(length,65),name='测试报告.pdf',stream=native(name,bytes);assert.deepEqual(nativePackage(stream),{filename:name,bytes});const packageBytes=cfb(stream);assert.deepEqual(compoundStreams(packageBytes).get(String.fromCharCode(1)+'Ole10Native'),stream);assert.deepEqual(extractEmbeddedFile(packageBytes,'xl/embeddings/oleObject1.bin'),{filename:name,bytes});}
});

test('XLSX中压缩包、常见文档及原始OLE附件按单元格归属，不需要作业正文文字',()=>{
 const names=['资料.zip','资料.rar','资料.7z','报告.pdf','报告.docx','数据.xlsx','展示.pptx','说明.txt'];
 const items=names.map(name=>({name,bytes:Buffer.from('Fixture bytes for '+name)}));
 items.push({name:'oleObject.bin',bytes:cfb(native('打包文件.zip',Buffer.from('original zip bytes')))});
 const result=homeworkFromFile(workbook(items),term),records=result.records.filter(r=>r.kind==='assignment');
 assert.equal(records.length,items.length);assert.equal(result.assets.length,items.length);
 for(const [i,r]of records.entries()){const a=r.attachments[0];assert.equal(a.field,'attachment');assert.equal(a.filename,i===names.length?'打包文件.zip':names[i]);assert.equal(a.mime,'application/octet-stream');assert.equal(r.course_name,'测试课程'+i);assert.ok(!a.filename.includes('original'));}
});

test('网页链接及HYPERLINK公式保留可点击目标，本地路径不导入',()=>{
 const result=homeworkFromFile(workbook([{url:'https://example.com/report.pdf',label:'下载报告'},{formula:'HYPERLINK("https://example.com/资料.zip","课程资料")'},{url:'file:///C:/Users/private/data.docx',label:'本地文件'},{label:'C:\\Users\\private\\local.docx'}],{content:'完成报告'}),term);
 const text=JSON.stringify(result);assert.ok(text.includes('https://example.com/report.pdf'));assert.ok(text.includes('example.com'));assert.ok(!text.includes('Users'));assert.ok(!text.includes('file:///'));assert.ok(result.warnings.some(w=>w.includes('电脑路径')));assert.equal(result.assets.length,0);
 assert.equal(homeworkTextParts(result.records.find(r=>r.course_name==='测试课程0').content).filter(p=>p.href).length,1);
});

test('链接只允许HTTP(S)，不执行公式、脚本或读取本地路径',()=>{
 assert.equal(safeHomeworkLink('javascript:alert(1)'),null);assert.equal(safeHomeworkLink('file:///C:/a.pdf'),null);
 assert.equal(safeHomeworkLink('https://user:password@example.com/a'),null);
 assert.equal(removeLocalFilePaths('C:\\Users\\test\\a.pdf'),'');assert.equal(removeLocalFilePaths('\\\\share\\folder\\a.pdf'),'');
 const parts=homeworkTextParts('资料：https://example.com/a?q=1&b=2。\n第二项 https://example.org/b');assert.equal(parts.filter(p=>p.href).length,2);assert.equal(parts.map(p=>p.text).join(''),'资料：https://example.com/a?q=1&b=2。\n第二项 https://example.org/b');
});

test('附件不能识别或没有锚点时明确提示，不伪造文件，不改变无作业规则',()=>{
 const unsupported=homeworkFromFile(workbook([{name:'oleObject.bin',bytes:Buffer.from('unsupported object')}]),term);assert.ok(unsupported.warnings.some(w=>w.includes('无法提取')));assert.equal(unsupported.assets.length,0);
 const unknown=homeworkFromFile(workbook([{name:'报告.pdf',bytes:Buffer.from('%PDF-fixture')}],{unbound:true}),term);assert.ok(unknown.warnings.some(w=>w.includes('未绑定单元格')));assert.equal(unknown.assets.length,0);
 const empty=homeworkFromFile(workbook([{name:'报告.pdf',bytes:Buffer.from('%PDF-fixture')}],{none:true}),term);assert.equal(empty.records.filter(r=>r.kind==='assignment').length,0);assert.ok(empty.warnings.some(w=>w.includes('附件未归入')));
});

test('附件重复引用按内容去重，损坏CFB与循环FAT不死循环',()=>{
 const bytes=Buffer.from('%PDF-fixture'),result=homeworkFromFile(workbook([{name:'a.pdf',bytes},{name:'b.pdf',bytes}]),term);assert.equal(result.assets.length,1);assert.equal(result.records.length,2);
 assert.equal(result.assets[0].id,createHash('sha256').update(bytes).digest('hex'));
 const broken=cfb(native('a.pdf',bytes));broken.writeUInt32LE(0,1024);assert.throws(()=>compoundStreams(broken));assert.throws(()=>nativePackage(Buffer.alloc(3)));
});

test('原生Office与PDF对象保留可下载内容，长路径只作为文件名元数据处理',()=>{
 const pdf=Buffer.from('%PDF-fixture');assert.deepEqual(extractEmbeddedFile(cfb(pdf,'CONTENTS'),'xl/embeddings/object.bin'),{filename:'object.pdf',bytes:pdf});
 const word=cfb(Buffer.from('legacy fixture'),'WordDocument');assert.deepEqual(extractEmbeddedFile(word,'xl/embeddings/object.bin'),{filename:'object.doc',bytes:word});
 const packageBytes=Buffer.from('PK office package');assert.deepEqual(extractEmbeddedFile(cfb(packageBytes,'Package'),'xl/embeddings/object.bin','Word.Document.12'),{filename:'object.docx',bytes:packageBytes});
});

test('WPS小写package支持Word/PPT/Excel，PDF内容流大小写兼容；兼容节点不重复导入',()=>{
 for(const [progId,path,ext] of [['Word.Document.12','word/document.xml','docx'],['PowerPoint.Show.12','ppt/presentation.xml','pptx'],['Excel.Sheet.12','xl/workbook.xml','xlsx']]){
  const bytes=zip({[path]:'<fixture/>'}),file=fieldWorkbook(2,cfb(bytes,'package'),progId,{cross:true});
  const parsed=homeworkFromFile(file,term),record=parsed.records.find(r=>r.kind==='assignment');
  assert.equal(parsed.assets.length,1);assert.equal(record.attachments.length,1);assert.equal(record.attachments[0].field,'content');
  assert.equal(record.attachments[0].filename,'oleObject1.'+ext);assert.deepEqual(Buffer.from(parsed.assets[0].content,'base64'),bytes);
  assert.ok(parsed.warnings.some(w=>w.includes('图标跨列')));assert.ok(!parsed.warnings.some(w=>w.includes('无法提取')||w.includes('内嵌附件未归入')));
 }
 const pdf=Buffer.from('%PDF-mainstream-fixture');assert.deepEqual(extractEmbeddedFile(cfb(pdf,'contents'),'object.bin'),{filename:'object.pdf',bytes:pdf});
});

test('文档附件保留作业内容、考核规则、提交方式、备注及独立附件的字段归属',()=>{
 const bytes=cfb(Buffer.from('%PDF-field-fixture'),'contents');
 for(const [col,field,kind] of [[2,'content','assignment'],[3,'assessment_rules','reference'],[4,'submission','reference'],[5,'notes','reference'],[6,'attachment','assignment']]){
  const parsed=homeworkFromFile(fieldWorkbook(col,bytes,'AcroExch.Document'),term);
  const record=parsed.records.find(r=>r.attachments.length);assert.equal(record.kind,kind);assert.equal(record.attachments[0].field,field);assert.equal(parsed.assets.length,1);
 }
 assert.equal(homeworkFromFile(fieldWorkbook(2,bytes,'AcroExch.Document',{none:true}),term).records.length,0);
});

test('内嵌附件从预览、导入到下载保留原始字节与文件名，匿名访问被拒绝',async t=>{
 const {server,db}=await createApp({databasePath:':memory:'});
 await createInitialAdmin(db,'attachment-fixture','附件测试管理员','AttachmentFixture123');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({studentId:'attachment-fixture',password:'AttachmentFixture123'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(path,body)=>{const response=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};
 const {id:termId}=await call('/admin/timetable/terms',{academicYear:'2026-2027',name:'第一学期',...term});
 await call('/admin/timetable/courses',{termId,source:'manual',acceptWarnings:true,courses:[{course_name:'测试课程0',teacher:'测试老师',explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}]});
 const bytes=Buffer.from('%PDF integration fixture'),filename='实验报告.pdf';
 const preview=await call('/admin/homework/preview',{termId,file:fieldWorkbook(2,cfb(native(filename,bytes)),'Package',{cross:true})});
 const record=preview.records.find(r=>r.kind==='assignment');assert.equal(record.attachments[0].filename,filename);assert.equal(record.matchCount,1);
 const imported=await call('/admin/homework/import',{termId,records:preview.records,assets:preview.assets,confirm:true});assert.equal(imported.created,1);
 const row=db.prepare('SELECT id FROM homework_records WHERE kind=?').get('assignment'),asset=record.attachments[0].assetId;
 const path=`/api/homework/assets/${asset}?recordId=${row.id}&field=content`;
 const download=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 assert.ok(decodeURIComponent(download.headers.get('content-disposition')).includes(filename));
 assert.equal((await fetch(base+path)).status,401);
 assert.equal((await fetch(base+path.replace(row.id,'missing'),{headers:{Cookie:cookie}})).status,404);
});
