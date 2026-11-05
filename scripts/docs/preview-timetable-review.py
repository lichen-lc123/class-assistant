import importlib.util
import json
from pathlib import Path
here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('docs_preview',here/'generate-documents.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
data=json.loads((here/'timetable-review-data.json').read_text(encoding='utf-8'))
for name,kind,label in [('外部AI内容导入','system','系统流程图'),('个人优先与公共同步','system','系统流程图')]:
    f=next(x for x in data if x['name']==name)
    r.preview(name,label,r.layout(f[kind]),scope='课表导入 · 待确认后开发',version='V0.2')
print('两张版面预览已生成。')
