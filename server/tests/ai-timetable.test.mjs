import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAiTimetable} from '../ai-timetable.mjs';
const data={schema_version:'timetable.v1',courses:[{course_name:'工程经济学',schedule_raw:'学校整页复制内容'}]};
test('AI整理结果支持完整标记、前后说明及原有JSON格式',()=>{
  const json=JSON.stringify(data);
  for(const text of [json,'\uFEFF'+json,'```json\n'+json+'\n```','【课表开始】\r\n'+json+'\r\n【课表结束】','整理完成\n【课表开始】\n'+json+'\n【课表结束】\n请核对','【课表开始】\n```json\n'+json+'\n```\n【课表结束】'])assert.deepEqual(parseAiTimetable(text),data);
  assert.deepEqual(parseAiTimetable(JSON.stringify({...data,warnings:['原始文字出现【课表开始】一词']})).courses,data.courses);
});
test('AI结果缺失结束、标记颠倒、多份结果和非结构化内容均明确拒绝',()=>{
  const json=JSON.stringify(data),block='【课表开始】\n'+json+'\n【课表结束】';
  for(const text of ['【课表开始】\n'+json,json+'\n【课表结束】','【课表结束】\n'+json+'\n【课表开始】',block+'\n'+block,'这是从学校复制的未整理原文','【课表开始】\n\n【课表结束】'])assert.throws(()=>parseAiTimetable(text),e=>e.status===400&&e.message.includes('课表结束'));
});
