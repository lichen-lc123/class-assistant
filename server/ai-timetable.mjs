const BEGIN='【课表开始】',END='【课表结束】';
function invalid(message){const e=new Error(message);e.status=400;throw e;}
export function parseAiTimetable(text){
  let content=text.replace(/^\uFEFF/,'').trim();
  const lines=content.split(/\r?\n/),opens=[],closes=[];
  lines.forEach((line,i)=>{if(line.trim()===BEGIN)opens.push(i);if(line.trim()===END)closes.push(i);});
  if(opens.length||closes.length){
    if(opens.length!==1||closes.length!==1||closes[0]<=opens[0])invalid('请完整粘贴一份从【课表开始】到【课表结束】的内容，不要遗漏结尾或同时粘贴多份。');
    content=lines.slice(opens[0]+1,closes[0]).join('\n').trim();
  }else if(content.startsWith(BEGIN)&&content.endsWith(END))content=content.slice(BEGIN.length,-END.length).trim();
  const fenced=content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);if(fenced)content=fenced[1].trim();
  try{return JSON.parse(content);}catch{invalid('整理结果不完整或格式不正确，请按本页提示词重新整理，并完整粘贴【课表开始】到【课表结束】的内容。');}
}
