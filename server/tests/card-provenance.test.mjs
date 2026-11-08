import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin} from '../database.mjs';

test('卡片按名称、老师和完整时间去重，手动与模板来源可同时展示',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'provenance-admin','测试管理员','FixtureProvenance123');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function call(path,method='GET',body){
    const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  cookie=(await call('/auth/login','POST',{studentId:'provenance-admin',password:'FixtureProvenance123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'测试学期',startsOn:'2026-09-01',endsOn:'2027-01-31'})).data.id;
  const course=(name,date='2026-11-14')=>({course_name:name,teacher:'测试老师',explicit_sessions:[{date,start_time:'08:00',end_time:'10:00',room:'教室甲'}]});
  const catalog=async()=>(await call('/admin/timetable/courses?termId='+termId)).data;
  const manual=c=>call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[c],acceptWarnings:true});
  async function importTemplate(name,courses){
    const body={termId,source:'ai',courses,acceptWarnings:true};
    const p=await call('/admin/timetable/template-preview','POST',body);assert.equal(p.status,200);
    const result=await call('/admin/timetable/template-import','POST',{...body,name,catalogVersion:p.data.catalogVersion});assert.equal(result.status,201);
    return result.data;
  }
  await t.test('先手动添加后导入同课模板，保留原卡片和两种标签',async()=>{
    const c=course('手动在先');assert.equal((await manual(c)).status,201);
    const original=(await catalog())[0];assert.deepEqual(original.creationSources,['manual']);
    const imported=await importTemplate('复用手动课',[{...c,room:'不同默认地点',explicit_sessions:[{...c.explicit_sessions[0],room:'不同教室'}]}]);
    assert.equal(imported.created,0);assert.equal(imported.reused,1);
    const cards=await catalog();assert.equal(cards.length,1);assert.equal(cards[0].id,original.id);
    assert.deepEqual(cards[0].creationSources,['template','manual']);assert.equal(cards[0].origin,'manual');
    assert.equal(cards[0].revision,original.revision);assert.equal(cards[0].sessions[0].room,'教室甲');
    assert.equal(db.prepare('SELECT course_id FROM template_courses WHERE template_id=?').get(imported.id).course_id,original.id);
    // This also covers reloading historical rows with the same existing relationships.
    assert.deepEqual((await catalog())[0].creationSources,['template','manual']);
  });
  await t.test('模板在先，再手动添加同课时拒绝且数据不变',async()=>{
    const c=course('模板在先','2026-11-15');await importTemplate('模板优先',[c]);
    const before=await catalog(),result=await manual(c);
    assert.equal(result.status,409);assert.match(result.data.message,/已经添加过了/);
    assert.deepEqual(await catalog(),before);
    assert.deepEqual(before.find(card=>card.course_name===c.course_name).creationSources,['template']);
  });
  await t.test('同名不同教师或任一课次时间不同，分别保留',async()=>{
    const c=course('手动在先');
    assert.equal((await manual({...c,teacher:'另一位老师'})).status,201);
    assert.equal((await manual({...c,explicit_sessions:[...c.explicit_sessions,{...c.explicit_sessions[0],date:'2026-11-21'}]})).status,201);
    assert.equal((await catalog()).filter(card=>card.course_name===c.course_name).length,3);
  });
});
