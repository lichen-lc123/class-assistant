export interface HomeworkAsset {id:string;mime:string;content:string}
export const attachmentFieldNames:Record<string,string>={content:'作业内容',assessment_rules:'考核规则',submission:'提交方式',team_requirement:'组队要求',notes:'补充说明',attachment:'附件'};
export interface HomeworkAttachment {assetId:string;field:string;caption:string;url?:string;mime?:string;filename?:string;size?:number}
export interface HomeworkTarget {key:string;identityKey?:string|null;timeLabel?:string;courseId:string|null;courseName?:string;teacher?:string;label?:string}
export interface Homework {
  id?:string;termId?:string;sourceType?:'personal'|'class';canEdit?:boolean;previewId?:string;existingId?:string|null;existingRevision?:number|null;hasUpdates?:boolean;kind:'assignment'|'reference';title:string;course_name:string;teacher:string;credits?:string;sequence?:string;
  course_entry_id?:string|null;
  allCompletedAt?:string|null;allCompletedGeneration?:number;
  draftReason?:string|null;
  auto_publish_on_match?:boolean;
  audience_mode?:'family'|'selected';course_time?:string;review_required?:boolean;review_reasons?:string[];
  allCompletionState?:boolean|null;
  priority?:'high'|'normal'|'low';planned_date?:string|null;planned_time?:string|null;
  content:string;submission:string;assessment_rules:string;team_requirement:string;notes:string;deadline_raw:string;due_date:string|null;due_time:string|null;
  autoPublish?:boolean;published:boolean;targetKeys?:string[];targets?:HomeworkTarget[];revision?:number;completed?:boolean;completedAt?:string|null;remindersSuppressed?:boolean;needsReconfirm?:boolean;overdue?:boolean;daysUntil?:number|null;
  attachments:HomeworkAttachment[];warnings:string[];source?:string;termName?:string;academicYear?:string;
}
export interface HomeworkPreview {records:Homework[];assets:HomeworkAsset[];classes:HomeworkTarget[];warnings:string[];sheets:string[];ignoredSheets:string[]}
export interface HomeworkSummary {pendingCount:number;overdueCount:number;records:Homework[]}
export const emptyHomework=():Homework=>({kind:'assignment',title:'',course_name:'',teacher:'',content:'',submission:'',assessment_rules:'',team_requirement:'',notes:'',deadline_raw:'',due_date:null,due_time:null,published:false,targetKeys:[],attachments:[],warnings:[]});
export const homeworkChanged=()=>window.dispatchEvent(new Event('homework-updated'));
export const deadlineLabel=(r:Homework)=>r.due_date?`${r.due_date}${r.due_time?' '+r.due_time:'（未注明具体时间）'}`:'截止时间待通知';
export function deadlineCountdown(r:Homework){
  if(!r.due_date||r.daysUntil==null||!Number.isFinite(r.daysUntil))return null;
  if(r.daysUntil<0)return `已逾期 ${Math.abs(r.daysUntil)} 天`;
  if(r.daysUntil===0)return r.overdue?'今天已逾期':'今天截止';
  return `距截止 ${r.daysUntil} 天`;
}
export const priorityNames={high:'高优先级',normal:'普通优先级',low:'低优先级'};
export const planLabel=(r:Homework)=>r.planned_date?`${r.planned_date}${r.planned_time?' '+r.planned_time:''}`:'';

export function courseTone(name:string){let value=0;for(const character of name.normalize('NFKC').replace(/\s/g,'').toLowerCase())value=(Math.imul(value,31)+character.codePointAt(0)!)>>>0;return value%6;}

export interface OwnCourseOption {entryId:string;termId:string;courseName:string;teacher:string;timeLabel:string}
