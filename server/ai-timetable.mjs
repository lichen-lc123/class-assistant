const BEGIN='【课表开始】',END='【课表结束】';
function invalid(message){const e=new Error(message);e.status=400;throw e;}
function escapedControls(text){
  let quoted=false,escaped=false,result='';
  for(const ch of text){
    if(quoted&&ch.charCodeAt(0)<32){if(escaped)return text;result+=JSON.stringify(ch).slice(1,-1);continue;}
    result+=ch;
    if(escaped){escaped=false;continue;}
    if(quoted&&ch==='\\'){escaped=true;continue;}
    if(ch==='"')quoted=!quoted;
  }
  return result;
}
export function parseAiTimetable(text){
  let content=text.replace(/^\uFEFF/,'').trim();
  const lines=content.split(/\r?\n/),opens=[],closes=[];
  lines.forEach((line,i)=>{if(line.trim()===BEGIN)opens.push(i);if(line.trim()===END)closes.push(i);});
  if(opens.length||closes.length){
    if(opens.length!==1||closes.length!==1||closes[0]<=opens[0])invalid('请完整粘贴一份从【课表开始】到【课表结束】的内容，不要遗漏结尾或同时粘贴多份。');
    content=lines.slice(opens[0]+1,closes[0]).join('\n').trim();
  }else if(content.startsWith(BEGIN)&&content.endsWith(END))content=content.slice(BEGIN.length,-END.length).trim();
  const fenced=content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);if(fenced)content=fenced[1].trim();
  try{return JSON.parse(content);}catch{
    // Doubao's copy/selection can leave literal tabs or newlines inside JSON
    // strings. Escape those characters without removing or guessing any data.
    const compatible=escapedControls(content);
    if(compatible!==content)try{return JSON.parse(compatible);}catch{}
    invalid('课表内容无法解析：请检查 JSON 格式，并完整粘贴【课表开始】到【课表结束】的内容；也可将结果交给 AI 修正格式后重试。');
  }
}
