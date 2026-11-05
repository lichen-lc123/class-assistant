export interface HomeworkAsset {id:string;mime:string;content:string}
export interface HomeworkTarget {key:string;classCode:string|null;courseId:string|null;courseName?:string;teacher?:string;label?:string}
export interface Homework {
  id?:string;termId?:string;sourceType?:'personal'|'class';canEdit?:boolean;previewId?:string;existingId?:string|null;kind:'assignment'|'reference';title:string;course_name:string;teacher:string;credits?:string;sequence?:string;
  priority?:'high'|'normal'|'low';planned_date?:string|null;planned_time?:string|null;
  content:string;submission:string;assessment_rules:string;team_requirement:string;notes:string;deadline_raw:string;due_date:string|null;due_time:string|null;
  published:boolean;targetKeys?:string[];targets?:HomeworkTarget[];revision?:number;completed?:boolean;completedAt?:string|null;remindersSuppressed?:boolean;needsReconfirm?:boolean;overdue?:boolean;daysUntil?:number|null;
  attachments:{assetId:string;field:string;caption:string;url?:string;mime?:string}[];warnings:string[];source?:string;termName?:string;academicYear?:string;
}
export interface HomeworkPreview {records:Homework[];assets:HomeworkAsset[];classes:HomeworkTarget[];warnings:string[];sheets:string[];ignoredSheets:string[]}
export interface HomeworkSummary {pendingCount:number;overdueCount:number;records:Homework[]}
export const emptyHomework=():Homework=>({kind:'assignment',title:'',course_name:'',teacher:'',content:'',submission:'',assessment_rules:'',team_requirement:'',notes:'',deadline_raw:'',due_date:null,due_time:null,published:false,targetKeys:[],attachments:[],warnings:[]});
export const homeworkChanged=()=>window.dispatchEvent(new Event('homework-updated'));
export const deadlineLabel=(r:Homework)=>r.due_date?`${r.due_date}${r.due_time?' '+r.due_time:'（未注明具体时间）'}`:'截止时间待通知';
export const priorityNames={high:'高优先级',normal:'普通优先级',low:'低优先级'};
export const planLabel=(r:Homework)=>r.planned_date?`${r.planned_date}${r.planned_time?' '+r.planned_time:''}`:r.sourceType==='personal'?'沿用作业截止时间':'沿用学委截止时间';
export const deadlineSourceLabel=(r:Homework)=>r.sourceType==='personal'?'个人作业截止时间':'学委发布的截止时间';
