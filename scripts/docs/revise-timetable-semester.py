"""Revise review-only timetable documents from annual to semester ownership."""
from pathlib import Path
import json

HERE=Path(__file__).resolve().parent
PROJECT=HERE.parents[1]
ROOT=PROJECT/'需求文档'/'讨论稿'
path=HERE/'timetable-review-data.json'
features=json.loads(path.read_text(encoding='utf-8').replace('学年','学期'))
features[0]['note']='以“用户＋学年＋学期”区分个人课表，每学期只保留一份当前课表，创建来源四选一。学年保留为所属年份，不作为整份课表的管理单位。删除只清除目标学期个人课表及覆盖，不删公共课程、模板、账号或其他学期；确认删除后才允许更换来源。'
features[0]['business'][0]='学生｜选择学年及学期\n每学期独立管理'
features[0]['system'][0]='前端｜提交学年和学期标识\n后端从会话识别用户'
features[0]['system'][1]='数据库｜按用户、学年、学期\n查询当前课表与 source_type'
features[0]['system'][-1]='数据库｜按用户、学年、学期\n校验唯一性并保存来源与课程关系'
excel=next(f for f in features if f['name']=='Excel课表导入')
excel['note']='一次可导入属于同一目标学期的多个文件，预览去重后生成一份学期课表。不同学期的数据分别导入、分别保存，不因处于同一学年而合并。秋、冬等学季如何对应学期由学校日历配置确定，不擅自假定。'
excel['business'][1]='学生｜上传属于所选学期的\n一个或多个课表文件'
excel['business'][3]='系统｜展示该学期课程清单\n保留各文件的原始学季与来源'
excel['system'][0]='前端｜提交学年、目标学期与文件\nsource_type=excel'
excel['system'][3]['text']='后端｜文件可读取且\n属于所选学年及学期？'
excel['system'][3]['fail']='提示损坏或格式错误\n跨学期数据须分别导入'
template=next(f for f in features if f['name']=='管理员模板与用户选择')
template['note']='管理员按学年和学期维护公共课程及模板，用户仅选择目标学期的模板。公共维护不受个人来源四选一限制。模板成员调整不自动增删个人已选课程；已选公共班级安排更新仍按个人覆盖优先处理。'
path.write_text(json.dumps(features,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

path=HERE/'generate-timetable-review.py'
text=path.read_text(encoding='utf-8').replace('学年','学期').replace('V0.2','V0.3')
text=text.replace('1. 课表针对学期，每名用户每学期只有一份当前课表；秋、冬等学季放在表内。','1. 课表按学期管理，以用户、学年、学期定位，每人每学期只有一份当前课表；不同学期分别保存，不因同一学年而自动合并。')
text=text.replace('- 同一来源内补充同一学期不同学季的数据属于继续维护当前课表，不算换来源；重复内容需预览确认，不创建第二份学期表。','- 同一来源内可补充属于同一学期的文件，预览去重后维护当前课表；不同学期的数据分别导入，不能写入当前学期。')
text=text.replace("'## 本版采用的细化解释，请随图确认','',", "'## 学期口径','',\n '学年仍保存，例如 2026—2027；个人课表的管理单位改为该学年下的具体学期。学校原始秋、冬、秋冬等学季标签原样保留，其与学期的映射由管理员依学校日历配置，不擅自合并或拆分。跨学期课程在各自学期中保存对应安排。','',\n '## 本版采用的细化解释，请随图确认','',")
path.write_text(text,encoding='utf-8')

path=ROOT/'课表导入功能梳理.md'
text=path.read_text(encoding='utf-8').replace('V0.2','V0.3')
text=text.replace('课表按学年管理，秋、冬等学季属于同一学年课表。每名用户每学年只保留一份当前课表，建立来源四选一；换来源先确认删除原个人课表，再建立新表。','课表按学期管理，以“用户＋学年＋学期”区分。每名用户每学期只保留一份当前课表，建立来源四选一；换来源先确认删除本学期原个人课表，再建立新表。不同学期独立保存，不因同属一个学年而自动合并。学年保留为归属信息，学校的学季与学期映射由日历配置确定。')
text=text.replace('上课班建议以学年与上课班编号识别。','个人课表按学年及学期隔离；上课班身份保留学年与上课班编号，跨学期课程分别保存各学期的上课安排。')
text=text.replace('支持选择多个课表文件，一次读取秋、冬等不同学季。解析后按学年、上课班编号及上课安排识别重复；没有编号时先提示候选。','支持一次选择属于同一目标学期的多个课表文件。不同学期分别导入、分别保存；同属一个学年也不默认合并。解析后在所选学年和学期内按上课班编号及安排识别重复；没有编号时先提示候选。')
text=text.replace('模板需显示学年、适用说明','模板需显示学年、学期、适用说明')
text=text.replace('用户选择学年并预览模板后确认使用；该学年已有其他来源课表时，先删除原个人课表再选择。','用户选择学年和学期，预览对应学期模板后确认使用；本学期已有其他来源课表时，先删除本学期原个人课表再选择。')
text=text.replace('可按学年、学季筛选','先选择学年和学期，再按原始学季等信息筛选')
text=text.replace('同一来源内补充同学年多个学季资料仍属当前来源，必须预览去重；换其他入口须先删除原课表。','同一来源内补充同一学期的资料仍属当前来源，必须预览去重；不同学期分别管理，换入口只需删除目标学期原课表。')
text=text.replace('仅清除该用户该学年的课程关系、个人安排和个人覆盖，不删除公共库、模板、账号及其他学年。','仅清除该用户目标学期的课程关系、个人安排和个人覆盖，不删除公共库、模板、账号及其他学期。')
path.write_text(text,encoding='utf-8')

path=ROOT/'课表AI解析提示词.md'
text=path.read_text(encoding='utf-8')
text=text.replace('同一用户每学年的个人课表只使用一种建立来源','同一用户每学期的个人课表只使用一种建立来源')
text=text.replace('2. 一份结果对应一个学年，秋、冬等学季放在该学年课程的 seasons 中，不拆成独立学年课表。不要混入其他学年。学年不能确定时填 null 并提示用户确认。','2. 一份结果对应所选学年下的一个学期。academic_year 保存学年，semester 保存目标学期名称。不同学期必须分别处理，不因同属一个学年而自动合并。原始秋、冬、秋冬等学季标签仍保留在 seasons 中；只有学校日历已明确其与学期映射时才据此归属，不擅自合并或拆分学期。学年、学期不能确定时相应字段填 null 并提示确认。')
text=text.replace('仅在“学年、上课班编号”均一致时自动合并课程','仅在同一目标学期内，且“学年、上课班编号”均一致时自动合并课程')
text=text.replace('  "academic_year": null,\n  "timezone"','  "academic_year": null,\n  "semester": null,\n  "timezone"')
text=text.replace('      "academic_year": null,\n      "seasons"','      "academic_year": null,\n      "semester": null,\n      "seasons"')
path.write_text(text,encoding='utf-8')

# Remove only the four obsolete annual diagram files created by the previous draft.
review=ROOT/'课表导入确认'
for category in ('业务流程图','系统流程图'):
    for old in (review/category/'学年课表与来源切换.svg',review/'Mermaid源文件'/category/'学年课表与来源切换.mmd'):
        if old.exists(): old.unlink()
print('讨论稿及绘图源数据已改为按学期管理。')
