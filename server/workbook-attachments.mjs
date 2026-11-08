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
          if(row!=null&&col!=null&&Number(row)<=10000&&Number(col)<=100)anchors.set(attr(shape[1],'id').replace(/^_x0000_s/,''),[Number(row),Number(col)]);
        }
      }
      if(/\/drawings\/[^/]+\.xml$/i.test(path))for(const anchor of xml(path).matchAll(/<(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)>/g)){
        const point=position(anchor[1]);if(point)for(const id of anchor[1].matchAll(/<(?:\w+:)?cNvPr\b([^>]*)/g))anchors.set(attr(id[1],'id'),point);
      }
    }
    for(const object of sheet.source.matchAll(/<(?:\w+:)?oleObject\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?oleObject>)/g)){
      if(++count>100)throw new Error('表格内嵌附件超过100个');
      const point=position(object[2]||'')||anchors.get(attr(object[1],'shapeId'));
      if(!point){warnings.push(sheet.name+' 有未绑定单元格的内嵌附件，无法确定对应作业，请手动补充。');continue;}
      const [row,col]=bound(...point),id='embedded_'+count,rel=allRels.get(attr(object[1],'r:id'));
      if(rel?.external){link([row,col],rel.target);continue;}
      let file=null;
      try{
        const path=rel?.target?resolve(posix.dirname(sheet.path),rel.target):'';
        if(!path.startsWith('xl/embeddings/'))throw new Error('附件不在内嵌目录');
        file=extractEmbeddedFile(entries.get(path),path,attr(object[1],'progId'));
      }catch{warnings.push(sheet.name+' 第'+(row+1)+'行有无法提取的内嵌附件，请在预览中手动补充。');}
      files.set(id,file);const key=row+'|'+col;sheet.files.set(key,[...(sheet.files.get(key)||[]),id]);
      sheet.rows[row]||=[];
    }
  }
  return{files,warnings};
}
