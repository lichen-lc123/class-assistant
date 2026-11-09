// Presentation feedback only; the server still validates the complete payload.
export function timetablePasteStatus(text){
 const value=text.trim(),begin='【课表开始】',end='【课表结束】';
 const opens=value.split(/\r?\n/).filter(line=>line.trim()===begin).length;
 const closes=value.split(/\r?\n/).filter(line=>line.trim()===end).length;
 let state='empty',message='支持长文本，粘贴后可上下滚动或放大编辑。';
 if(value){
  if(opens===1&&closes===1&&value.indexOf(begin)<value.lastIndexOf(end)||!opens&&!closes&&value.startsWith(begin)&&value.endsWith(end)){state='complete';message='首尾标记齐全';}
  else if(opens&&!closes||value.startsWith(begin)&&!value.endsWith(end)){state='missing-end';message='缺少【课表结束】，请检查是否复制完整。';}
  else if(closes&&!opens){state='missing-start';message='缺少【课表开始】，请检查是否复制完整。';}
  else if(opens||closes){state='invalid-markers';message='请仅粘贴一份完整课表，检查首尾标记及顺序。';}
  else{state='unmarked';message=value.startsWith('{')?'已接收 JSON 内容，可点击查看安排。':'未检测到首尾标记，请核对粘贴内容。';}
 }
 return{characters:text.length,state,message};
}
