"""Add review-only rules for locating current semester/day/week/month."""
from pathlib import Path
import json

HERE=Path(__file__).resolve().parent
PROJECT=HERE.parents[1]
ROOT=PROJECT/'需求文档'/'讨论稿'
feature={
 'name':'课表默认定位与时间视图',
 'note':'进入课表自动定位当前学期，默认显示今天课程，突出正在上课和下一节。切换学期、月、周、日视图时定位相应当前时间；周一至周日为自然周，教学周按配置日历单独标注。用户主动浏览其他日期时不强制跳回，点击“回到今天”恢复自动定位。课表只展示本人所选上课班及其个人覆盖结果。',
 'business':[
  '学生｜进入我的课表',
  '系统｜按课程时区的今天\n查找当前学期',
  {'text':'系统｜能确定唯一当前学期？','kind':'decision','fail':'无进行中学期则提示选择\n多个学期匹配则由学生确认','yes':'是','no':'否'},
  {'text':'系统｜本人已有本学期课表？','kind':'decision','fail':'提示先建立当前学期课表\n不自动展示旧学期代替','yes':'是','no':'否'},
  '系统｜默认显示今天的课\n突出正在上课和下一节',
  '学生｜切换学期、月、周、日视图\n各自定位当前时间范围',
  '系统｜显示对应范围内课程\n没有课时明确提示',
  '学生｜可浏览其他时期\n点击回到今天恢复默认定位'
 ],
 'system':[
  '前端｜提交本人视图选择\n首次进入采用今天和日视图',
  '后端｜从会话识别用户\n按 Asia/Shanghai 计算当前时刻',
  '数据库｜读取学期起止日期\n定位当前学年与学期',
  {'text':'后端｜当前学期匹配唯一？','kind':'decision','fail':'返回无匹配或多匹配提示\n不猜测，前端允许选择学期','yes':'是','no':'否'},
  '数据库｜读取本人所选班级\n公共安排及个人覆盖',
  '后端｜个人值优先合成实际安排\n按所选学期及日期范围筛选',
  '后端｜生成正在上课、下一节\n已结束及待安排状态',
  '前端｜渲染今天或所选范围\n空课表与缺失时间分开提示',
  '前端｜自动定位模式下\n跨日或回到页面时重新定位',
  '学生｜手动浏览其他日期时\n保持所选范围，回到今天后恢复自动'
 ]
}
path=HERE/'timetable-review-data.json'
data=json.loads(path.read_text(encoding='utf-8'))
data=[f for f in data if f['name']!=feature['name']]+[feature]
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

path=HERE/'generate-timetable-review.py'
text=path.read_text(encoding='utf-8').replace('V0.3','V0.4')
text=text.replace(" '个人优先与公共同步':", " '课表默认定位与时间视图':{(1,2):'视图、日期及所选学期',(3,4):'学期日期范围与匹配结果',(5,6):'本人课程、公共基值及个人覆盖',(6,7):'筛选后的实际课程安排',(7,8):'课程状态、空结果及待安排提示'},\n '个人优先与公共同步':")
text=text.replace("'6. 网站没有内置 AI。用户在外部 AI 处理资料，再带回结果；网站只使用常规程序解析、校验和提示。','',", "'6. 网站没有内置 AI。用户在外部 AI 处理资料，再带回结果；网站只使用常规程序解析、校验和提示。',\n '7. 默认优先定位当前学期与今天的课，学期、月、周、日视图均支持定位当前范围；学生主动浏览其他时期时不强制跳回。','',")
text=text.replace("'## 学期口径','',", "'## 当前时间的默认展示','',\n '详细规则见[课表默认定位与时间视图需求说明](需求规格说明书/课表默认定位与时间视图.md)。默认采用日视图，突出正在上课与下一节；其他视图定位本月、本周或当前学期。当天无课时显示今日无课和本学期下一次课，无进行中学期时允许手动选择。','',\n '## 学期口径','',")
text=text.replace("assert len(list(ROOT.rglob('*.svg')))==12", "assert len(list(ROOT.rglob('*.svg')))==len(FEATURES)*2")
text=text.replace("assert len(list(ROOT.rglob('*.mmd')))==12", "assert len(list(ROOT.rglob('*.mmd')))==len(FEATURES)*2")
text=text.replace("print('已生成并校验 12 张待确认流程图与 12 份 Mermaid 源文件。')", "print(f'已生成并校验 {len(FEATURES)*2} 张待确认流程图与 {len(FEATURES)*2} 份 Mermaid 源文件。')")
path.write_text(text,encoding='utf-8')

path=ROOT/'课表导入功能梳理.md'
text=path.read_text(encoding='utf-8').replace('V0.3','V0.4')
text+='''
## 默认展示当前时间范围

- 自动定位今天所属学期，默认日视图突出正在上课与下一节；支持学期、月、周、日切换，各视图首次定位当前范围。
- 使用课程时区 Asia/Shanghai；自然周为周一至周日，教学周根据学校日历单独标注。
- 今日无课时明确显示“今日无课”，可显示本学期下一次课；当前学期尚无个人课表则提示先建立，不用旧学期替代。
- 用户主动浏览其他时期时不强制跳回；“回到今天”恢复默认定位，自动模式下跨日及页面重新获得焦点时更新。
- 未确定日期时间的课程保留在待安排，不进入今天、本周等准确时段，也不显示正在上课。

详细规则见[需求说明](课表导入确认/需求规格说明书/课表默认定位与时间视图.md)，对应两张流程图已加入确认目录。
'''
path.write_text(text,encoding='utf-8')
print('已补入默认定位与时间视图规则，待生成流程图。')
