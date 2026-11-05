"""Generate phase-one Markdown specifications, SVG diagrams and Mermaid sources.

Uses Python standard libraries. Optional --preview uses the already installed Pillow.
Does not open or modify the application database.
"""
from pathlib import Path
from html import escape
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / '需求文档'
DATE = '2026-11-02'
FEATURES = json.loads(Path(__file__).with_name('requirements-data.json').read_text(encoding='utf-8'))
FONT = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif"

def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')

def wrap(text, limit):
    lines = []
    for paragraph in text.split('\n'):
        line, used = '', 0
        for char in paragraph:
            units = 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
            if line and used + units > limit:
                lines.append(line)
                line, used = '', 0
            line += char
            used += units
        lines.append(line)
    return lines

def layout(steps):
    nodes, edges = [], []
    full = [{'text': '开始', 'kind': 'terminal'}]
    full += [s if isinstance(s, dict) else {'text': s, 'kind': 'process'} for s in steps]
    full += [{'text': '结束', 'kind': 'terminal'}]
    for i, item in enumerate(full):
        kind = item.get('kind', 'process')
        if kind == 'process' and item['text'].startswith('数据库｜'):
            kind = 'database'
        lines = wrap(item['text'], 25 if kind == 'decision' else 44)
        height = max(74, len(lines) * 23 + 28)
        if kind == 'decision': height = max(124, len(lines) * 23 + 38)
        node = dict(id=f'N{i}', text=item['text'], kind=kind, x=70, y=145 + i * 172,
                    w=440, h=height, lines=lines)
        nodes.append(node)
        if i:
            previous = full[i - 1]
            edges.append((f'N{i-1}', f'N{i}', previous.get('yes', '是') if previous.get('kind') == 'decision' else ''))
        if kind == 'decision':
            side_lines = wrap(item['fail'], 39)
            side = dict(id=f'B{i}', text=item['fail'], kind='exception', x=645,
                        y=node['y'], w=385, h=max(80, len(side_lines) * 23 + 28), lines=side_lines)
            side['y'] += (height - side['h']) / 2
            nodes.append(side)
            edges.append((node['id'], side['id'], item.get('no', '否')))
    return nodes, edges, 1100, int(nodes[-1]['y'] + nodes[-1]['h'] + 90)

def colors(node):
    if node['kind'] == 'decision': return '#F0ECE2', '#A69B83'
    if node['kind'] == 'exception': return '#F2EAE6', '#B09B91'
    if node['kind'] == 'terminal': return '#E5ECE2', '#8A9D82'
    if node['kind'] == 'database': return '#E7EDF0', '#8A9CA6'
    if node['text'].startswith('后端｜'): return '#F2EFE8', '#A59D8B'
    if node['text'].startswith('前端｜'): return '#EDF1E9', '#95A08D'
    return '#FFFFFF', '#A8B2A2'

def draw_svg(name, category, nodes, edges, width, height):
    elements = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
        f'<title id="title">{escape(name)} · {category}</title>',
        f'<desc id="desc">一期已实现功能。{escape(category)}，包括正常路径及主要异常分支；异常分支在本次处理结束，修正后重新发起。</desc>',
        '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L9 4.5 L0 9 Z" fill="#7E8C7A"/></marker></defs>',
        f'<rect width="{width}" height="{height}" fill="#F7F5F0"/>',
        f'<g font-family="{FONT}" fill="#344235">',
        f'<text x="70" y="55" font-size="29" font-weight="700">{escape(name)} · {category}</text>',
        f'<text x="70" y="90" font-size="15" fill="#788371">V1.0 · {DATE} · 一期登录与账号管理</text>',
        f'<text x="70" y="116" font-size="13" fill="#788371">{"使用者操作与业务判断" if category == "业务流程图" else "前端请求、后端校验及数据库处理"}；右侧为本次处理的其他结果。</text>']
    lookup = {n['id']: n for n in nodes}
    for first, last, label in edges:
        a, b = lookup[first], lookup[last]
        if a['x'] == b['x']:
            x = a['x'] + a['w']/2
            sy, ey = a['y'] + a['h'], b['y']
            path = f'M{x} {sy} L{x} {ey-4}'
            lx, ly = x+15, (sy+ey)/2+5
        else:
            x, y = a['x'] + a['w'], a['y'] + a['h']/2
            ex, ey = b['x'], b['y'] + b['h']/2
            path = f'M{x} {y} L{ex-4} {ey}'
            lx, ly = (x+ex)/2-8, y-12
        elements.append(f'<path d="{path}" stroke="#7E8C7A" stroke-width="1.7" fill="none" marker-end="url(#arrow)"/>')
        if label: elements.append(f'<text x="{lx}" y="{ly}" font-size="15" fill="#66765D">{escape(label)}</text>')
    for node in nodes:
        x,y,w,h = (node[k] for k in ('x','y','w','h'))
        fill, stroke = colors(node)
        if node['kind'] == 'decision':
            elements.append(f'<polygon points="{x+w/2},{y} {x+w},{y+h/2} {x+w/2},{y+h} {x},{y+h/2}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
        elif node['kind'] == 'database':
            elements.append(f'<path d="M{x} {y+13} A{w/2} 13 0 0 1 {x+w} {y+13} L{x+w} {y+h-13} A{w/2} 13 0 0 1 {x} {y+h-13} Z" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
            elements.append(f'<path d="M{x} {y+13} A{w/2} 13 0 0 0 {x+w} {y+13}" stroke="{stroke}" fill="none"/>')
        else:
            radius = h/2 if node['kind'] == 'terminal' else 12
            elements.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
        font_size = 16 if node['kind'] in ('decision','exception') else 17
        ty = y + h/2 - (len(node['lines'])-1)*11.5 + 6
        elements.append(f'<text text-anchor="middle" font-size="{font_size}">')
        for line in node['lines']:
            elements.append(f'<tspan x="{x+w/2}" y="{ty}">{escape(line)}</tspan>')
            ty += 23
        elements.append('</text>')
    elements.append(f'<text x="70" y="{height-30}" font-size="13" fill="#88917F">图例：圆角端点＝开始 / 结束；矩形＝处理；菱形＝判断；圆柱＝数据库；右侧＝其他结果。</text>')
    elements.append('</g></svg>')
    return '\n'.join(elements)

def mermaid(name, category, nodes, edges):
    result = [f'%% {name} · {category} · V1.0 · {DATE}', 'flowchart TD']
    for n in nodes:
        label = n['text'].replace('&', '&amp;').replace('"','&quot;').replace('\n','<br/>')
        opening, closing = ('{','}') if n['kind']=='decision' else ('([','])') if n['kind']=='terminal' else ('[(',')]') if n['kind']=='database' else ('[',']')
        result.append(f'    {n["id"]}{opening}"{label}"{closing}')
    for a,b,label in edges:
        result.append(f'    {a} -->{f"|{label}|" if label else ""} {b}')
    result += ['    classDef normal fill:#FFFFFF,stroke:#A8B2A2,color:#344235;',
        '    classDef decision fill:#F0ECE2,stroke:#A69B83,color:#344235;',
        '    classDef terminal fill:#E5ECE2,stroke:#8A9D82,color:#344235;',
        '    classDef exception fill:#F2EAE6,stroke:#B09B91,color:#344235;',
        '    classDef database fill:#E7EDF0,stroke:#8A9CA6,color:#344235;']
    for n in nodes:
        result.append(f'    class {n["id"]} {n["kind"] if n["kind"] in ("decision","terminal","exception","database") else "normal"};')
    return '\n'.join(result)+'\n'

def specification(feature, number):
    f = feature
    text = [f'# {f["name"]}需求规格说明书', '', f'功能编号：F{number:02d}  |  版本：V1.0  |  更新日期：{DATE}  |  状态：已实现'+('（本机运维入口）' if f['name']=='管理员初始化' else ''), '',
        '## 功能目标', '', f['goal'], '', '## 使用者与前置条件', '',
        f'- 使用者：{f["actor"]}。', f'- 前置条件：{f["pre"]}', '',
        '## 输入与输出', '', '| 项目 | 内容 |', '|---|---|',
        f'| 输入 | {f["input"]} |',f'| 输出 | {f["output"]} |','',
        '## 业务规则', '']
    text += [f'{i}. {v}' for i,v in enumerate(f['rules'],1)]
    text += ['', '## 异常处理', ''] + ['- '+v for v in f['exceptions']]
    text += ['', '## 验收标准', ''] + [f'{i}. {v}' for i,v in enumerate(f['acceptance'],1)]
    text += ['', '## 系统接口与数据', '', f'- 入口：{f["api"]}', f'- 数据处理：{f["data"]}', '',
        '## 对应流程图', '', f'- [业务流程图](../流程图/业务流程图/{f["name"]}.svg)',
        f'- [系统流程图](../流程图/系统流程图/{f["name"]}.svg)',
        f'- [业务流程图源文件](../流程图源文件/业务流程图/{f["name"]}.mmd)',
        f'- [系统流程图源文件](../流程图源文件/系统流程图/{f["name"]}.mmd)', '',
        '## 实现依据', '']
    text += [f'- [{s}](../../{s})' for s in f['sources']]
    text += ['', '本说明以当前一期功能为准；角色、通用字段及范围说明见[文档目录](../文档目录.md)。', '']
    return '\n'.join(text)

def index():
    lines = ['# 一期需求文档目录', '', f'版本：V1.0  |  更新日期：{DATE}', '',
        '本目录记录当前已实现的登录与账号管理功能，每个功能分别存放一份需求规格说明书、一张业务流程图和一张系统流程图。', '',
        '## 文件位置与阅读方式', '',
        '- `需求规格说明书/功能名称.md`：可编辑的功能说明，包含规则、异常和验收标准。',
        '- `流程图/业务流程图/功能名称.svg`：使用者操作与业务判断，可直接用浏览器打开、缩放或打印。',
        '- `流程图/系统流程图/功能名称.svg`：前端、后端、数据库之间的处理逻辑。',
        '- `流程图源文件/业务流程图/功能名称.mmd` 与 `流程图源文件/系统流程图/功能名称.mmd`：对应 Mermaid 源文件。',
        '- SVG 与 MMD 是同一张图的不同格式；流程图右侧分支表示本次处理的其他结果，修正后可重新发起。', '',
        '## 功能索引', '', '| 编号 | 功能 | 需求规格说明书 | 业务流程图 | 系统流程图 |', '|---|---|---|---|---|']
    for i,f in enumerate(FEATURES,1):
        name=f['name']
        lines.append(f'| F{i:02d} | {name} | [说明书](需求规格说明书/{name}.md) | [业务图](流程图/业务流程图/{name}.svg) | [系统图](流程图/系统流程图/{name}.svg) |')
    lines += ['', '## 一期范围', '',
        '本期完成账号登录、退出、本人改密、管理员账号管理，以及运行前的管理员初始化。课表导入与展示暂缓；上课班、作业发布、作业完成状态、微信提醒和手机通知仍待后续需求确认与开发，当前未实现，不作为已交付功能列入本次逐功能文档。', '',
        '网站采用莫兰迪色系，前端适配电脑与手机浏览器。仅有学生和管理员两种角色；账号管理是系统设置的主要内容。', '',
        '## 权限约定', '', '| 操作 | 学生 | 管理员 |', '|---|---|---|',
        '| 登录、退出、查看本人信息、修改本人密码 | 允许 | 允许 |',
        '| 系统设置、查询、创建、编辑、批量导入、重置和删除账号 | 不允许 | 完成初始改密后允许 |',
        '| 管理员初始化 | 不提供网页入口 | 由本机维护人员在没有管理员时执行 |', '',
        '首次改密账号在完成改密前，只能查询本人信息、修改密码和退出。管理员的重置密码入口不用于本人，本人密码由“我的账号”修改。', '',
        '## 核心业务约定', '',
        '1. 重复学号不覆盖原账号信息、角色和密码；批量导入报告跳过结果。',
        '2. 删除账号后立即拒绝后续登录并撤销所有原会话；前端会在受保护请求或窗口重新获得焦点校验时识别失效。',
        '3. 密码使用独立盐和 scrypt 哈希保存，管理员不能查看原密码，文档不记载实际密码。',
        '4. 修改密码、重置密码、学号或角色变更均按对应说明撤销旧会话；当前退出仅撤销当前设备会话。',
        '5. 账号唯一比较不区分大小写；学号始终按文本处理，以保留前导零。',
        '6. 最后一名管理员不能被删除或降级，当前登录账号不能删除自己。', '',
        '## 数据约定', '', '| 数据表 | 主要字段 | 用途 |', '|---|---|---|',
        '| users | id、student_id、name、role、password_hash、must_change_password、created_at、updated_at | 账号身份、权限与密码状态 |',
        '| sessions | token_hash、user_id、expires_at | 登录会话，关联账号并支持撤销 |', '',
        '数据库使用现有 Node.js 内置 SQLite，存放于 `data/homework.sqlite`。账号 ID 为内部稳定标识，学号可编辑，数据重启后保留。会话有效期为 8 小时；Cookie 使用 HttpOnly、SameSite=Strict，数据库仅存令牌摘要。当前在本机运行，未部署公网。', '',
        '## 维护说明', '',
        '本次仅新增文档，不修改账号、数据库、前后端业务代码，也不安装软件或依赖。实现依据为对应说明书中的源码链接。流程图由同一份节点与连线数据生成 SVG 和 Mermaid，二者保持对应。', '',
        '后续修改功能时，应同步更新同名说明书与两类流程图，避免只更新其中一种。', '']
    return '\n'.join(lines)

def preview(name, category, graph, scope='一期登录与账号管理', version='V1.0'):
    from PIL import Image, ImageDraw, ImageFont
    nodes,edges,w,h=graph
    image=Image.new('RGB',(w,h),'#F7F5F0'); draw=ImageDraw.Draw(image)
    font_path='C:/Windows/Fonts/msyh.ttc'
    title_font=ImageFont.truetype(font_path,28)
    label_font=ImageFont.truetype(font_path,15)
    draw.text((70,25),f'{name} · {category}',font=title_font,fill='#344235')
    draw.text((70,78),f'{version} · {DATE} · {scope}',font=label_font,fill='#788371')
    lookup={n['id']:n for n in nodes}
    for a,b,label in edges:
        first,last=lookup[a],lookup[b]
        if first['x']==last['x']:
            start=(first['x']+first['w']/2,first['y']+first['h']); end=(last['x']+last['w']/2,last['y'])
            triangle=[end,(end[0]-5,end[1]-10),(end[0]+5,end[1]-10)]
            lp=(start[0]+15,(start[1]+end[1])/2-9)
        else:
            start=(first['x']+first['w'],first['y']+first['h']/2); end=(last['x'],last['y']+last['h']/2)
            triangle=[end,(end[0]-10,end[1]-5),(end[0]-10,end[1]+5)]
            lp=((start[0]+end[0])/2-8,start[1]-26)
        draw.line([start,end],fill='#7E8C7A',width=2); draw.polygon(triangle,fill='#7E8C7A')
        if label: draw.text(lp,label,font=label_font,fill='#66765D')
    for n in nodes:
        x,y,w,h=(n[k] for k in ('x','y','w','h')); fill,stroke=colors(n)
        if n['kind']=='decision': draw.polygon([(x+w/2,y),(x+w,y+h/2),(x+w/2,y+h),(x,y+h/2)],fill=fill,outline=stroke,width=2)
        else: draw.rounded_rectangle((x,y,x+w,y+h),radius=h/2 if n['kind']=='terminal' else 12,fill=fill,outline=stroke,width=2)
        font=ImageFont.truetype(font_path,16 if n['kind'] in ('decision','exception') else 17)
        for i,line in enumerate(n['lines']):
            box=draw.textbbox((0,0),line,font=font)
            assert box[2]-box[0] < n['w']-20, (name,line)
            draw.text((x+w/2,y+h/2+(i-(len(n['lines'])-1)/2)*23),line,font=font,fill='#344235',anchor='mm')
    target=Path(__file__).parent/'qa'/f'{name}-{category}.png'
    target.parent.mkdir(exist_ok=True)
    image.save(target)

def validate():
    for path in ROOT.rglob('*.svg'):
        tree=ET.parse(path)
        assert tree.getroot().tag.endswith('svg')
        assert tree.find('{http://www.w3.org/2000/svg}title') is not None
    for path in ROOT.rglob('*.md'):
        for link in re.findall(r'\]\(([^)]+)\)',path.read_text(encoding='utf-8')):
            assert (path.parent/link).resolve().exists(), (path,link)
    for feature in FEATURES:
        for kind in ('业务流程图','系统流程图'):
            assert (ROOT/'流程图'/kind/f'{feature["name"]}.svg').exists()
            assert (ROOT/'流程图源文件'/kind/f'{feature["name"]}.mmd').exists()

def main():
    for number,feature in enumerate(FEATURES,1):
        write(ROOT/'需求规格说明书'/f'{feature["name"]}.md',specification(feature,number))
        for key,category in (('business','业务流程图'),('system','系统流程图')):
            graph=layout(feature[key]); nodes,edges,w,h=graph
            assert len({n['id'] for n in nodes})==len(nodes)
            assert all(n['y']+n['h']<=h for n in nodes)
            write(ROOT/'流程图'/category/f'{feature["name"]}.svg',draw_svg(feature['name'],category,*graph))
            write(ROOT/'流程图源文件'/category/f'{feature["name"]}.mmd',mermaid(feature['name'],category,nodes,edges))
            if '--preview' in sys.argv and (feature['name'],category) in [('登录','业务流程图'),('批量导入账号','系统流程图'),('角色权限控制','系统流程图')]:
                preview(feature['name'],category,graph)
    write(ROOT/'文档目录.md',index())
    validate()
    print(f'已生成并校验：{len(FEATURES)} 份说明书、{len(FEATURES)*2} 张 SVG 流程图、{len(FEATURES)*2} 份 Mermaid 源文件及文档目录。')

if __name__=='__main__': main()
