export function importSaveIssue({admin,name,preview,accepted}:{admin:boolean;name:string;preview:{courses:unknown[];importBlocked?:boolean;importError?:string|null}|null;accepted:boolean}){
  if(admin&&!name.trim())return{target:'name',message:'请先填写模板名称。'} as const;
  if(!preview)return{target:'preview',message:'请先粘贴 AI 结果并点击“查看安排”。'} as const;
  if(preview.importBlocked)return{target:'preview',message:preview.importError||'课程存在重复时段，请先调整后再保存。'} as const;
  if(!preview.courses.length)return{target:'preview',message:'没有可保存的课程，请重新导入。'} as const;
  if(!accepted)return{target:'confirmation',message:'请先勾选下方的“我已核对”确认，再保存。'} as const;
  return null;
}
