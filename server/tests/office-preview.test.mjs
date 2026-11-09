import test from 'node:test';
import assert from 'node:assert/strict';
import {officePreview} from '../office-preview.mjs';

// Small synthetic archives contain no personal course or document data.
import {zip} from './fixtures/zip.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const paragraph=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>';

test('Word 内容预览保留标题、文字、表格和内嵌图片，不加载外链',()=>{
 const bytes=zip({'word/document.xml':'<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>课程资料</w:t></w:r></w:p>'+paragraph('&lt;script&gt;仅作为文字&lt;/script&gt;')+'<w:tbl><w:tr><w:tc>'+paragraph('表格内容')+'</w:tc></w:tr></w:tbl><w:p><a:blip r:embed="image1"/><a:blip r:embed="outside"/></w:p></w:body></w:document>','word/_rels/document.xml.rels':'<Relationships><Relationship Id="image1" Target="media/image1.png"/><Relationship Id="outside" Target="https://example.com/private.png" TargetMode="External"/></Relationships>','word/media/image1.png':png});
 const result=officePreview(bytes,'课程资料.docx'),blocks=result.pages[0].blocks;
 assert.equal(result.format,'document');assert.equal(blocks[0].type,'heading');assert.equal(blocks[1].text,'<script>仅作为文字</script>');assert.equal(blocks[2].rows[0][0][0].text,'表格内容');assert.equal(blocks.filter(b=>b.type==='image').length,1);assert.equal(blocks[3].src,'data:image/png;base64,'+png.toString('base64'));assert.ok(!JSON.stringify(result).includes('example.com'));
});

test('PPT 内容预览遵循演示顺序并保留每页文字和图片',()=>{
 const slide=text=>'<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp><p:pic><a:blip r:embed="img"/></p:pic></p:spTree></p:cSld></p:sld>';
 const result=officePreview(zip({'ppt/presentation.xml':'<p:presentation><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>','ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>','ppt/slides/slide1.xml':slide('第一页文件'),'ppt/slides/slide2.xml':slide('应首先展示'),'ppt/slides/_rels/slide2.xml.rels':'<Relationships><Relationship Id="img" Target="../media/image1.png"/></Relationships>','ppt/media/image1.png':png}),'课程演示.pptx');
 assert.equal(result.format,'presentation');assert.equal(result.pages.length,2);assert.equal(result.pages[0].blocks[0].text,'应首先展示');assert.equal(result.pages[0].blocks[1].type,'image');assert.equal(result.pages[1].blocks[0].text,'第一页文件');
});

test('旧文档和压缩包保留下载回退，损坏或外部实体文档不执行',()=>{
 for(const filename of ['资料.doc','演示.ppt','资料.zip'])assert.equal(officePreview(Buffer.from('original'),filename).format,'unsupported');
 assert.throws(()=>officePreview(Buffer.from('broken'),'坏文件.docx'));
 assert.throws(()=>officePreview(zip({'word/document.xml':'<!DOCTYPE w [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document/>'}),'实体.docx'));
});
