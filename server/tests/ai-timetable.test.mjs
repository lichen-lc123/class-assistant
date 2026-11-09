import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAiTimetable} from '../ai-timetable.mjs';
import {timetablePasteStatus} from '../../shared/timetable-paste.mjs';
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

test('长课表完整接收与首尾提示，兼容换行、说明和纯JSON，不把字段中的标记当边界',()=>{
 const large={schema_version:'timetable.v1',courses:Array.from({length:30},(_,i)=>({course_name:'长课表课程'+i,teacher:'测试老师',remarks_raw:'完整课表文字😀'.repeat(1000)}))};
 const json=JSON.stringify(large,null,2),text='说明\r\n【课表开始】\r\n'+json+'\r\n【课表结束】\r\n请核对';assert.ok(text.length>100000);
 assert.deepEqual(parseAiTimetable(text),large);assert.equal(timetablePasteStatus(text).characters,text.length);assert.equal(timetablePasteStatus(text).state,'complete');
 assert.equal(timetablePasteStatus('【课表开始】\n'+json).state,'missing-end');assert.equal(timetablePasteStatus(json+'\n【课表结束】').state,'missing-start');
 assert.equal(timetablePasteStatus('【课表结束】\n'+json+'\n【课表开始】').state,'invalid-markers');assert.equal(timetablePasteStatus(json).state,'unmarked');
 assert.equal(timetablePasteStatus(JSON.stringify({warnings:['原文提到【课表开始】']})).state,'unmarked');
});

test('豆包复制带入字符串内原始制表符或换行时保持原文；不猜补其他损坏JSON',()=>{
 const raw='【课表开始】\n{"schema_version":"timetable.v1","courses":[{"course_name":"格式测试","schedule_raw":"选修\t课程\r\n补充说明","remarks_raw":"原文\\n转义"}]}\n【课表结束】';
 const parsed=parseAiTimetable(raw);assert.equal(parsed.courses[0].schedule_raw,'选修\t课程\n补充说明');assert.equal(parsed.courses[0].remarks_raw,'原文\n转义');
 for(const broken of ['{"courses":[{"course_name":"未结束\t内容}', '{"courses":[],}', '{"courses":[],"value":"x\\\n续行"}'])assert.throws(()=>parseAiTimetable(broken),e=>e.status===400&&/格式|解析/.test(e.message));
});
