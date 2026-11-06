import {useHomeworkUpdate} from './useHomeworkUpdate';
import type {ReactNode} from 'react';
import {CheckCircle2,Download,Paperclip} from 'lucide-react';
import {fileSize} from './HomeworkAttachmentsEditor';
import {courseTone,deadlineLabel,planLabel,priorityNames,type Homework,type HomeworkAsset} from './types';
const fields=[['submission','提交方式'],['assessment_rules','考核规则'],['team_requirement','组队要求'],['notes','补充说明']] as const;
function HomeworkImages({record,field,label,assets}:{record:Homework;field:string;label:string;assets:HomeworkAsset[]}){
  return <>{record.attachments.filter(a=>a.field===field).map(a=>{const asset=assets.find(x=>x.id===a.assetId),mime=asset?.mime||a.mime,url=asset?`data:${mime};base64,${asset.content}`:a.url;return url&&mime?.startsWith('image/')?<figure key={a.assetId}><a href={url} target="_blank" rel="noreferrer"><img loading="lazy" src={url} alt={a.filename||label}/></a><figcaption>{a.filename||label} · 点击查看原图</figcaption></figure>:null;})}</>;
}
function HomeworkFiles({record,assets}:{record:Homework;assets:HomeworkAsset[]}){
  const files=record.attachments.filter(a=>a.field==='attachment'||!(assets.find(x=>x.id===a.assetId)?.mime||a.mime||'image/').startsWith('image/'));
  if(!files.length)return null;
  return <section className="homework-file-downloads" aria-label="作业附件"><h3><Paperclip size={16}/>附件（{files.length}）</h3>{files.map(a=>{const asset=assets.find(x=>x.id===a.assetId),url=asset?`data:${asset.mime};base64,${asset.content}`:a.url;return url?<a key={a.assetId+':'+a.field} href={asset?url:url+'&download=1'} download={a.filename||'作业附件'}><Paperclip size={17}/><span><strong>{a.filename||a.caption||'作业附件'}</strong>{a.size&&<small>{fileSize(a.size)}</small>}</span><Download size={17}/></a>:null;})}</section>;
}
export function HomeworkCard({record:r,assets=[],children,expandDetails=false,trackUpdates=true}:{record:Homework;assets?:HomeworkAsset[];children?:ReactNode;expandDetails?:boolean;trackUpdates?:boolean}){
  const update=useHomeworkUpdate(r,trackUpdates);
  const contentImages=r.attachments.some(a=>a.field==='content'&&(assets.find(x=>x.id===a.assetId)?.mime||a.mime||'image/').startsWith('image/'));
  const extraFields=fields.filter(([key])=>r[key]||r.attachments.some(a=>a.field===key));
  return <article onClick={e=>{if(!(e.target as Element).closest('button,a,input,select,textarea'))void update.acknowledge();}} className={`homework-card workspace-card homework-tone-${courseTone(r.course_name||'个人事项')} ${r.completed?'homework-completed':''}`}><header>{update.unread&&<button type="button" className="homework-update-badge" onClick={()=>void update.acknowledge()} aria-label="有更新，点击标记为已读">有更新</button>}<div className="homework-course-heading"><h2>{r.course_name||'个人事项'}</h2>{(r.teacher||r.sourceType!=='personal')&&<p className="homework-teacher"><span>任课老师</span><strong>{r.teacher||'待确认'}</strong></p>}<h3 className="homework-task-title">{r.title}</h3></div><span className={`homework-status ${r.overdue?'overdue':''}`}>{!r.published?'草稿':r.kind==='reference'?'考核说明':r.completed?'已完成':r.overdue?'已逾期':'待完成'}</span></header>
    {update.error&&<p className="feedback" role="alert">{update.error}</p>}
    {(r.kind==='assignment'||r.content||contentImages)&&<section className="homework-main-content" aria-label="作业内容"><h3>作业内容</h3>{r.content?<p className="homework-text">{r.content}</p>:!contentImages&&<p className="muted-note">作业内容待补充</p>}<HomeworkImages record={r} field="content" label="作业图片" assets={assets}/></section>}
    <HomeworkFiles record={r} assets={assets}/>
    {r.kind==='assignment'&&<><div className={`homework-deadline ${r.overdue?'is-overdue':''}`}><span>截止时间</span><strong>{deadlineLabel(r)}</strong>{!r.completed&&r.daysUntil!=null&&r.daysUntil>=0&&<span className="homework-due-countdown">{r.daysUntil===0?'今天截止':`距截止 ${r.daysUntil} 天`}</span>}</div>{(r.priority||r.planned_date)&&<div className="homework-personal-plan">{r.priority&&<span>{priorityNames[r.priority]}</span>}{r.planned_date&&<p>计划完成时间：{planLabel(r)}</p>}</div>}</>}

    {r.completed&&<p className="homework-completed-note"><CheckCircle2 size={15}/>已完成 · 不再列入后续作业提醒</p>}
    {r.needsReconfirm&&<p className="notice">{r.sourceType==='personal'?'个人作业内容已修改，请重新确认完成状态。':'学委更新了内容，请重新核对后标记完成。'}</p>}
    {!!extraFields.length&&(expandDetails?<div className="homework-details">{extraFields.map(([key,label])=><section key={key}><h3>{label}</h3>{r[key]&&<p className="homework-text">{r[key]}</p>}<HomeworkImages record={r} field={key} label={label+'图片'} assets={assets}/></section>)}</div>:<details className="homework-details"><summary>提交方式、考核与补充说明</summary>{extraFields.map(([key,label])=><section key={key}><h3>{label}</h3>{r[key]&&<p className="homework-text">{r[key]}</p>}<HomeworkImages record={r} field={key} label={label+'图片'} assets={assets}/></section>)}</details>)}{children&&<footer>{children}</footer>}</article>;
}
