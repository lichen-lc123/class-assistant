import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';
import {createInitialAdmin, tokenHash} from '../database.mjs';

const DAY=24*60*60*1000;
test('电脑和手机登录不自动到期、服务重启与主动退出（独立测试数据库）',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mem2602-login-'));
  const databasePath=join(directory,'fixture.sqlite');
  const start=Date.now();
  t.mock.timers.enable({apis:['Date'],now:start});
  let app,base;
  async function open(){
    app=await createApp({databasePath});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${app.server.address().port}`;
  }
  async function close(){if(app?.server.listening)await new Promise(resolve=>app.server.close(resolve));}
  t.after(async()=>{await close();await rm(directory,{recursive:true,force:true});});
  await open();
  await createInitialAdmin(app.db,'persistent-fixture','测试账号','PersistentFixture123');
  async function call(path,method='GET',body,cookie,agent='Desktop fixture'){
    const response=await fetch(base+'/api'+path,{method,headers:{'User-Agent':agent,
      ...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json(),setCookie:response.headers.get('set-cookie')};
  }
  const login=agent=>call('/auth/login','POST',{studentId:'persistent-fixture',password:'PersistentFixture123'},undefined,agent);
  const desktop=await login('Desktop fixture'),mobile=await login('Mobile fixture');
  for(const result of [desktop,mobile]){
    assert.equal(result.status,200);
    assert.match(result.setCookie,/Max-Age=34560000/);
    assert.match(result.setCookie,/HttpOnly/);assert.match(result.setCookie,/SameSite=Strict/);
    assert.equal('token' in result.data,false);
  }
  const desktopCookie=desktop.setCookie.split(';')[0],mobileCookie=mobile.setCookie.split(';')[0];
  assert.notEqual(desktopCookie,mobileCookie);
  const desktopKey=tokenHash(desktopCookie.slice(8)),mobileKey=tokenHash(mobileCookie.slice(8));
  assert.equal(app.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(desktopKey).expires_at,0);
  assert.match((await call('/auth/me','GET',undefined,desktopCookie)).setCookie,/Max-Age=34560000/);

  // A fresh browser process sends its retained cookie; the server needs no page or memory state.
  await close();t.mock.timers.setTime(start+2*DAY);await open();
  for(const [cookie,key] of [[desktopCookie,desktopKey],[mobileCookie,mobileKey]]){
    const result=await call('/auth/me','GET',undefined,cookie);
    assert.equal(result.status,200);assert.equal(result.data.studentId,'persistent-fixture');
    assert.match(result.setCookie,/Max-Age=34560000/);
    assert.equal(app.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(key).expires_at,0);
    assert.match((await call('/auth/me','GET',undefined,cookie)).setCookie,/Max-Age=34560000/);
  }
  // Existing eight-hour cookies can be upgraded without asking the user to log in again.
  app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()+60*60*1000,desktopKey);
  assert.match((await call('/auth/me','GET',undefined,desktopCookie)).setCookie,/Max-Age=34560000/);

  const logout=await call('/auth/logout','POST',{},desktopCookie);
  assert.equal(logout.status,200);assert.match(logout.setCookie,/Max-Age=0/);
  assert.equal((await call('/auth/me','GET',undefined,desktopCookie)).status,401);
  assert.equal((await call('/auth/me','GET',undefined,mobileCookie)).status,200);
  // Long inactivity does not expire a persistent server session.
  t.mock.timers.setTime(start+3000*DAY);
  await close();await open();
  assert.equal((await call('/auth/me','GET',undefined,mobileCookie)).status,200);
  // Expired legacy tokens are never resurrected.
  app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1,mobileKey);
  await close();await open();
  const expired=await call('/auth/me','GET',undefined,mobileCookie);
  assert.equal(expired.status,401);assert.match(expired.setCookie,/Max-Age=0/);
  assert.equal((await call('/auth/me')).status,401);
});
