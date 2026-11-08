import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {reconcileCourses} from '../server/reconcile-courses.mjs';

const source=resolve(process.env.DATABASE_PATH||'data/homework.sqlite');
if(!existsSync(source))throw new Error('数据库不存在，未创建空数据库。');
const apply=process.argv.includes('--apply'),db=new DatabaseSync(source);
try{
  db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=10000');
  if(apply){
    const directory=join(dirname(source),'backups');mkdirSync(directory,{recursive:true});
    const destination=join(directory,'before-course-reconcile-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
    await backup(db,destination);console.log(JSON.stringify({backup:destination}));
  }
  const report=reconcileCourses(db,{apply});console.log(JSON.stringify(report));
  if(process.argv.includes('--check-clean')&&['termsUpdated','payloadsUpdated','confirmedSchedulesFixed','cardsMerged','entriesMerged','targetsUpdated'].some(key=>report[key]!==0))throw new Error('历史数据处理不是幂等的，停止发布。');
}finally{db.close();}
