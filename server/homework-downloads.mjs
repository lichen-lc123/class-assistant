import {randomBytes,createHash} from 'node:crypto';
import {problem} from './schedule.mjs';
const hash=token=>createHash('sha256').update(token).digest('hex');
const lifetime=15*60*1000;

export function homeworkDownloads(db,loadFile){
 function create(session,assetId,recordId,field){
  const file=loadFile(recordId,assetId,field,session.user),token=randomBytes(32).toString('hex'),expiresAt=Date.now()+lifetime;
  db.prepare('DELETE FROM homework_download_links WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO homework_download_links VALUES(?,?,?,?,?,?)').run(hash(token),session.key,recordId,assetId,file.field,expiresAt);
  db.prepare('DELETE FROM homework_download_links WHERE session_key=? AND token_hash NOT IN (SELECT token_hash FROM homework_download_links WHERE session_key=? ORDER BY expires_at DESC,token_hash LIMIT 50)').run(session.key,session.key);
  return{url:'/api/homework/downloads/'+token+'/'+encodeURIComponent(file.name),expiresAt};
 }
 function handle({req,path,res}){
  const match=path.match(/^\/api\/homework\/downloads\/([a-f0-9]{64})\/[^/]+$/);if(!match)return false;
  if(!['GET','HEAD'].includes(req.method))problem('下载方式不正确。',405);
  const link=db.prepare('SELECT d.*,s.user_id,s.expires_at AS session_expiry,u.role,u.must_change_password FROM homework_download_links d JOIN sessions s ON s.token_hash=d.session_key JOIN users u ON u.id=s.user_id WHERE d.token_hash=?').get(hash(match[1]));
  if(!link||link.expires_at<=Date.now()||link.session_expiry!==0&&link.session_expiry<=Date.now()||link.must_change_password)problem('下载链接已失效，请返回作业重新获取下载链接。',410);
  const file=loadFile(link.record_id,link.asset_id,link.field,{id:link.user_id,role:link.role});
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.bytes.length,'Content-Disposition':`attachment; filename="homework-file"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
  res.end(req.method==='HEAD'?undefined:Buffer.from(file.bytes));return true;
 }
 return{create,handle};
}
