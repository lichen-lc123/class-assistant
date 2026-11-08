export function safeHomeworkLink(value){
  if(typeof value!=='string'||value.length>4000)return null;
  try{const u=new URL(value.trim());return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function removeLocalFilePaths(value){
  return String(value||'').replace(/(?:file:\/\/[^\r\n]+|(?<![A-Za-z0-9])[a-z]:[\\/][^\r\n]+|\\\\[^\\\r\n]+\\[^\r\n]+)/gi,'').trim();
}
export function homeworkTextParts(value){
  const text=String(value||''),result=[];let last=0;
  for(const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)){
    const candidate=m[0].replace(/[.,;!?，。；！？，、)）\]】]+$/,''),href=safeHomeworkLink(candidate);if(!href)continue;
    if(m.index>last)result.push({text:text.slice(last,m.index),href:null});result.push({text:candidate,href});last=m.index+candidate.length;
  }
  if(last<text.length)result.push({text:text.slice(last),href:null});return result;
}
