import {posix} from 'node:path';
import {extractEmbeddedFile} from './embedded-files.mjs';
import {safeHomeworkLink} from '../shared/homework-links.mjs';
// No URLs or local paths are fetched; only bytes already inside the workbook are read.
export function workbookAttachments({sheets,entries,xml,attr,resolve,cell,relationships}){
  const files=new Map(),warnings=[];let count=0;
  const position=source=>{
    const from=source.match(/<(?:\w+:)?from\b[^>]*>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1]||'';
    const row=Number(from.match(/<(?:\w+:)?row\b[^>]*>(\d+)<\/(?:\w+:)?row>/)?.[1]??NaN),col=Number(from.match(/<(?:\w+:)?col\b[^>]*>(\d+)<\/(?:\w+:)?col>/)?.[1]??NaN);
    return Number.isInteger(row)&&Number.isInteger(col)&&row<=10000&&col<=100?[row,col]:null;
  };
  for(const sheet of sheets){
    sheet.files=new Map();
    const header=sheet.rows.find(r=>r?.includes('课程名称')&&r.some(v=>/作业.*内容/.test(v)))||sheet.rows.find(r=>r?.includes('课次')&&r.includes('作业内容'));
    const isField=col=>header&&/作业.*内容|提交平台|课程考核规则|是否需要组队|备注|附件|参考资料|资料文件|下载链接/.test(header[col]||'');
    // A floating icon can start in the preceding metadata column. Only move it
    // when its explicit geometry covers a unique supported content column.
    function fieldPosition(point,source){
      if(isField(point[1])||!header)return point;
      const to=source.match(/<(?:\w+:)?to\b[^>]*>([\s\S]*?)<\/(?:\w+:)?to>/)?.[1]||'';
      const end=Number(to.match(/<(?:\w+:)?col\b[^>]*>(\d+)<\/(?:\w+:)?col>/)?.[1]??NaN);
      if(!Number.isInteger(end)||end<point[1]||end>100)return point;
      const from=source.match(/<(?:\w+:)?from\b[^>]*>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1]||'';
      const offset=s=>Number(s.match(/<(?:\w+:)?colOff\b[^>]*>(\d+)<\/(?:\w+:)?colOff>/)?.[1]||0);
      const widths=[...sheet.source.matchAll(/<(?:\w+:)?col\b([^>]*\bwidth=[^>]*)\/?>/g)];
      const width=col=>{const entry=widths.find(m=>Number(attr(m[1],'min'))<=col+1&&Number(attr(m[1],'max'))>=col+1);return((Number(entry?attr(entry[1],'width'):8.43)||8.43)*7+5)*9525;};
      const candidates=[];
      for(let col=point[1];col<=end;col++)if(isField(col)){const overlap=(col===end?offset(to):width(col))-(col===point[1]?offset(from):0);if(overlap>0)candidates.push({col,overlap});}
      candidates.sort((a,b)=>b.overlap-a.overlap);
      if(candidates.length&&(!candidates[1]||candidates[0].overlap>candidates[1].overlap)){
        warnings.push(sheet.name+' 第'+(point[0]+1)+'行的附件图标跨列，已归入“'+header[candidates[0].col]+'”，请核对。');
        return[point[0],candidates[0].col];
      }
      return point;
    }
    const relPath=posix.join(posix.dirname(sheet.path),'_rels',posix.basename(sheet.path)+'.rels'),rels=relationships(relPath);
    const allRels=new Map([...xml(relPath).matchAll(/<(?:\w+:)?Relationship\b([^>]+)\/?\s*>/g)].map(m=>[attr(m[1],'Id'),{target:attr(m[1],'Target'),external:attr(m[1],'TargetMode')==='External'}]));
    const bound=(row,col)=>{const m=sheet.merges.find(m=>row>=m.r1&&row<=m.r2&&col>=m.c1&&col<=m.c2);return m?[m.r1,m.c1]:[row,col];};
    const link=(ref,target)=>{
      if(!ref)return;const [row,col]=bound(...(Array.isArray(ref)?ref:cell(ref.split(':')[0])));
      if(row>10000||col>100)throw new Error('附件链接位置超出表格范围');
      const url=safeHomeworkLink(target);
      if(url){sheet.rows[row]||=[];const previous=String(sheet.rows[row][col]||'');if(!previous.includes(url))sheet.rows[row][col]=[previous,url].filter(Boolean).join('\n');}
      else warnings.push(sheet.name+' 有非网页链接（电脑路径或不支持的链接），未作为附件导入。');
    };
    for(const m of sheet.source.matchAll(/<(?:\w+:)?hyperlink\b([^>]*)\/?\s*>/g)){
      const rel=allRels.get(attr(m[1],'r:id'));if(rel)link(attr(m[1],'ref'),rel.target);
    }
    const anchors=new Map();
    for(const target of rels.values()){
      const path=resolve(posix.dirname(sheet.path),target);
      if(/\.vml$/i.test(path)){
        for(const shape of xml(path).matchAll(/<(?:\w+:)?shape\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?shape>/g)){
          const row=shape[2].match(/<(?:\w+:)?Row>(\d+)<\/(?:\w+:)?Row>/)?.[1],col=shape[2].match(/<(?:\w+:)?Column>(\d+)<\/(?:\w+:)?Column>/)?.[1];
          const vml=shape[2].match(/<(?:\w+:)?Anchor>([^<]+)<\/(?:\w+:)?Anchor>/)?.[1]?.split(',').map(Number);
          const point=row!=null&&col!=null?[Number(row),Number(col)]:vml?.length===8&&vml.every(Number.isFinite)?[vml[2],vml[0]]:null;
          if(point&&point.every(n=>n>=0)&&point[0]<=10000&&point[1]<=100)anchors.set(attr(shape[1],'id').replace(/^_x0000_s/,''),{point,source:''});
        }
      }
      if(/\/drawings\/[^/]+\.xml$/i.test(path))for(const anchor of xml(path).matchAll(/<(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)>/g)){
        const point=position(anchor[1]);if(point)for(const id of anchor[1].matchAll(/<(?:\w+:)?cNvPr\b([^>]*)/g))anchors.set(attr(id[1],'id'),{point,source:anchor[1]});
      }
    }
    const seen=new Set();
    for(const object of sheet.source.matchAll(/<(?:\w+:)?oleObject\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?oleObject>)/g)){
      const objectKey=attr(object[1],'shapeId')+'|'+attr(object[1],'r:id');if(seen.has(objectKey))continue;seen.add(objectKey);
      if(++count>100)throw new Error('表格内嵌附件超过100个');
      const fallback=anchors.get(attr(object[1],'shapeId')),source=object[2]||fallback?.source||'';
      let point=position(source)||fallback?.point;
      if(!point){warnings.push(sheet.name+' 有未绑定单元格的内嵌附件，无法确定对应作业，请手动补充。');continue;}
      point=fieldPosition(point,source);
      const [row,col]=bound(...point),id='embedded_'+count,rel=allRels.get(attr(object[1],'r:id'));
      if(rel?.external){link([row,col],rel.target);continue;}
      let file=null;
      try{
        const path=rel?.target?resolve(posix.dirname(sheet.path),rel.target):'';
        if(!path.startsWith('xl/embeddings/'))throw new Error('附件不在内嵌目录');
        file=extractEmbeddedFile(entries.get(path),path,attr(object[1],'progId'));
      }catch{warnings.push(sheet.name+' 第'+(row+1)+'行有无法提取的内嵌附件，请在预览中手动补充。');}
      files.set(id,file?{...file,field:/附件|参考资料|资料文件|下载链接/.test(header?.[col]||'')?'attachment':null}:null);const key=row+'|'+col;sheet.files.set(key,[...(sheet.files.get(key)||[]),id]);
      sheet.rows[row]||=[];
    }
  }
  return{files,warnings};
}
