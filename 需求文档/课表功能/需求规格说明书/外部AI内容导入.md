# 外部AI内容导入需求规格说明书

更新：2026-11-09；与当前功能一致。

使用者：本人及管理员；管理导入仅电脑。

入口：课表管理 → AI 整理导入；管理员导入模板。

## 当前规则

1. 复制系统提示词，在外部 AI 整理学校课程文字后粘贴 JSON；AI 入口不提供文件上传，不内置模型。
2. 提示词与服务端使用同一完整学期校历规则；周次、日期、星期、起止时间及地点按真实资料生成，课程编号和班号不再作为匹配依据。
3. 一个学期默认同一教室；有明确逐课地点时保留差异。导入默认已核对，仍可自行修改；缺少真实时间的课程保留待安排，不编造数据。
4. 以完整明确日期清单优先的已确认来源规则处理特定原表矛盾，不能给其他课程、老师或人工修改后的日期套用修正。
5. 个人导入追加课表，预览与保存均检查已有和本批次时间冲突；不创建公共卡片，也不覆盖公共模板。

## 接口与数据

GET /api/timetable/prompt；课表预览及保存接口

个人导入不修改 public_courses；校历规则来自 shared/course-week.mjs。

## 对应流程

- [业务流程图](../流程图/业务流程图/外部AI内容导入.svg)
- [系统流程图](../流程图/系统流程图/外部AI内容导入.svg)
- [业务源文件](../流程图源文件/业务流程图/外部AI内容导入.mmd)
- [系统源文件](../流程图源文件/系统流程图/外部AI内容导入.mmd)

## 实现依据

- [server/ai-timetable.mjs](../../../server/ai-timetable.mjs)
- [server/confirmed-schedule.mjs](../../../server/confirmed-schedule.mjs)
- [shared/course-week.mjs](../../../shared/course-week.mjs)
- [src/timetable/ImportDialog.tsx](../../../src/timetable/ImportDialog.tsx)

本文件及两类流程由 `scripts/docs/update-current-documents.py` 同步生成；更新只涉及文档，不读取或修改真实数据库。
