import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {zip} from './fixtures/zip.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const asset=(bytes,mime='application/octet-stream')=>({id:createHash('sha256').update(bytes).digest('hex'),mime,content:bytes.toString('base64')});
const ref=(a,filename,field='attachment')=>({assetId:a.id,filename,field,caption:''});

test('作业图片与附件上传、保留、移除、下载及私人权限',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'upload-admin','学委','UploadAdminFixture123');
  const pass=await hashPassword('UploadStudentFixture123');
  for(const id of ['upload-one','upload-two','upload-outside'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,pass);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const login=async(studentId,password)=>(await call('/auth/login','POST',{studentId,password})).cookie;
  const admin=await login('upload-admin','UploadAdminFixture123'),one=await login('upload-one','UploadStudentFixture123'),two=await login('upload-two','UploadStudentFixture123'),outside=await login('upload-outside','UploadStudentFixture123');
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期'},admin)).data.id;
  assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:[{course_name:'图片附件课程',teacher:'课程老师',explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}],acceptWarnings:true},admin)).status,201);
  const course=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data[0];
  const entries=[];for(const cookie of [one,two])entries.push((await call('/timetable/'+termId,'POST',{source:'cards',courseIds:[course.id],acceptWarnings:true},cookie)).data.courses[0].id);
  const image=asset(png,'image/png'),pdfBytes=Buffer.from('%PDF-1.4\nfixture homework document\n%%EOF'),pdf=asset(pdfBytes),privateBytes=Buffer.from('仅本人可见的作业附件'),privateFile=asset(privateBytes);
  const record={kind:'assignment',title:'图片和附件作业',course_name:course.course_name,teacher:course.teacher,content:'',targetKeys:['course:'+course.id],published:true,attachments:[ref(image,'题目截图.png','content'),ref(pdf,'作业说明.pdf')]};
  let shared,personal;
  const download=(url,cookie)=>fetch(base+url,{headers:cookie?{Cookie:cookie}:{}});
  await t.test('文档预览复用原附件权限，保存后的旧字段无需重导，原文件字节保持不变',async()=>{
    const bytes=zip({'word/document.xml':'<w:document><w:body><w:p><w:r><w:t>课程作业文档</w:t></w:r></w:p></w:body></w:document>'}),document=asset(bytes);
    const saved=await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'文档预览',course_entry_id:entries[0],attachments:[ref(document,'作业.docx','content')]},assets:[document]},one);assert.equal(saved.status,201);
    const url=saved.data.attachments[0].url;
    const preview=await download(url+'&preview=1',one);assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');assert.equal((await preview.json()).pages[0].blocks[0].text,'课程作业文档');
    for(const cookie of [two,admin,outside])assert.equal((await download(url+'&preview=1',cookie)).status,403);
    assert.equal((await download(url+'&preview=1')).status,401);
    assert.deepEqual(Buffer.from(await (await download(url,one)).arrayBuffer()),bytes);
  });
  await t.test('单独发布草稿保留原附件、文件名、所属字段和下载权限',async()=>{
    const draft=await call('/admin/homework/records','POST',{termId,record:{...record,title:'待发布附件',published:false},assets:[image,pdf]},admin);assert.equal(draft.status,201);
    assert.equal((await download(draft.data.attachments[0].url,one)).status,403);
    const published=await call('/admin/homework/records/'+draft.data.id+'/publish','POST',{revision:draft.data.revision},admin);assert.equal(published.status,200);assert.equal(published.data.attachments.length,2);
    const file=published.data.attachments.find(a=>a.filename==='作业说明.pdf');assert.deepEqual(Buffer.from(await (await download(file.url,one)).arrayBuffer()),pdfBytes);
    assert.equal(published.data.attachments.find(a=>a.filename==='题目截图.png').field,'content');assert.equal((await download(file.url,outside)).status,403);
  });
  await t.test('管理员发布图片和附件，授权学生可预览图片并下载中文文件名',async()=>{
    const saved=await call('/admin/homework/records','POST',{termId,record,assets:[image,pdf]},admin);assert.equal(saved.status,201);shared=saved.data;
    const detail=(await call('/homework/records/'+shared.id,'GET',undefined,one)).data;
    assert.equal(detail.attachments.length,2);
    const picture=detail.attachments.find(a=>a.mime==='image/png'),file=detail.attachments.find(a=>a.filename==='作业说明.pdf');
    assert.equal(picture.size,png.length);assert.equal(file.size,pdfBytes.length);
    const response=await download(picture.url,one);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^inline/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    const attachment=await download(file.url,two);assert.equal(attachment.status,200);assert.equal(attachment.headers.get('content-type'),'application/octet-stream');assert.match(attachment.headers.get('content-disposition'),/^attachment/);assert(attachment.headers.get('content-disposition').includes(encodeURIComponent('作业说明.pdf')));assert.deepEqual(Buffer.from(await attachment.arrayBuffer()),pdfBytes);
    assert.equal((await download(file.url,outside)).status,403);assert.equal((await download(file.url)).status,401);
    const wrongField=new URL(file.url,base);wrongField.searchParams.set('field','notes');
    assert.equal((await download(wrongField.pathname+wrongField.search,one)).status,404);
  });
  await t.test('个人上传图片附件，管理员和其他同学均不能读取私人内容',async()=>{
    const saved=await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'个人上传',course_entry_id:entries[0],attachments:[ref(image,'个人截图.png','content'),ref(privateFile,'个人报告.docx')]},assets:[image,privateFile]},one);
    assert.equal(saved.status,201);personal=saved.data;assert.equal(personal.attachments.length,2);
    const file=personal.attachments.find(a=>a.filename==='个人报告.docx');
    assert.deepEqual(Buffer.from(await(await download(file.url,one)).arrayBuffer()),privateBytes);
    for(const cookie of [admin,two,outside])assert.equal((await download(file.url,cookie)).status,403);
  });
  await t.test('知道其他文件哈希也不能引用：失败整批回滚，不创建半份作业',async()=>{
    const count=db.prepare('SELECT count(*) n FROM homework_records').get().n;
    for(const cookie of [one,two]){
      const file=cookie===one?pdf:privateFile;
      assert.equal((await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'盗用文件',course_entry_id:cookie===one?entries[0]:entries[1],attachments:[ref(file,'伪造附件')]}},cookie)).status,400);
    }
    assert.equal((await call('/admin/homework/records','POST',{termId,record:{...record,title:'管理员也不能引用私人文件',attachments:[ref(privateFile,'不应获取.docx')]}},admin)).status,400);
    assert.equal(db.prepare('SELECT count(*) n FROM homework_records').get().n,count);
  });
  await t.test('编辑保留已有附件无需重新上传，移除文件后旧下载地址失效',async()=>{
    const retained=await call('/homework/personal/'+personal.id,'PUT',{revision:1,record:{...personal,title:'附件保留'}},one);assert.equal(retained.status,200);assert.equal(retained.data.attachments.length,2);
    const picture=personal.attachments.find(a=>a.mime==='image/png'),file=personal.attachments.find(a=>a.filename==='个人报告.docx');
    const removed=await call('/homework/personal/'+personal.id,'PUT',{revision:2,record:{...retained.data,attachments:[file]}},one);assert.equal(removed.status,200);assert.equal(removed.data.attachments.length,1);
    assert.equal((await download(picture.url,one)).status,404);assert.equal((await download(file.url,one)).status,200);
    const updated=await call('/admin/homework/records/'+shared.id,'PUT',{revision:1,record:{...shared,targetKeys:record.targetKeys,title:'课程附件保留'}},admin);assert.equal(updated.status,200);assert.equal(updated.data.attachments.length,2);
  });
  await t.test('各字段中的非图片文件强制下载，不能伪造MIME或绕过字节校验',async()=>{
    const html=asset(Buffer.from('<script>alert("fixture")</script>'));
    const saved=await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'普通文件下载',course_entry_id:entries[0],attachments:[ref(html,'说明.html')]},assets:[html]},one);assert.equal(saved.status,201);
    const response=await download(saved.data.attachments[0].url,one);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const fieldFile=await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'正文PDF附件',course_entry_id:entries[0],attachments:[ref(pdf,'说明.pdf','content')]},assets:[pdf]},one);assert.equal(fieldFile.status,201);assert.equal(fieldFile.data.attachments[0].field,'content');
    const fieldDownload=await download(fieldFile.data.attachments[0].url,one);assert.equal(fieldDownload.headers.get('content-type'),'application/octet-stream');assert.match(fieldDownload.headers.get('content-disposition'),/^attachment/);
    for(const [a,r] of [[{...image,id:'0'.repeat(64)},ref({...image,id:'0'.repeat(64)},'错误校验.png','content')],[{...image,content:image.content+'?junk'},ref(image,'坏数据.png','content')],[{...pdf,mime:'image/png'},ref(pdf,'文件伪装.png','content')]]){
      assert.equal((await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'无效文件',course_entry_id:entries[0],attachments:[r]},assets:[a]},one)).status,400);
    }
  });
  await t.test('拒绝超大文件与超出合计限制的上传，既有数据不受影响',async()=>{
    const before=db.prepare('SELECT count(*) n FROM homework_records').get().n;
    const large=asset(Buffer.alloc(10*1024*1024+1,1));
    assert.equal((await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'超大文件',course_entry_id:entries[0],attachments:[ref(large,'太大.zip')]},assets:[large]},one)).status,400);
    const files=[1,2,3].map(n=>asset(Buffer.alloc(7*1024*1024,n)));
    assert.equal((await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'合计超限',course_entry_id:entries[0],attachments:files.map((f,i)=>ref(f,'文件'+i))},assets:files},one)).status,400);
    assert.equal(db.prepare('SELECT count(*) n FROM homework_records').get().n,before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
