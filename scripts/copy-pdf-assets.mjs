import {cp,mkdir,readFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const source=resolve('node_modules/pdfjs-dist'),version=JSON.parse(await readFile(resolve(source,'package.json'),'utf8')).version;
const target=resolve('public/pdfjs',version);await mkdir(target,{recursive:true});
for(const name of ['cmaps','standard_fonts','wasm'])await cp(resolve(source,name),resolve(target,name),{recursive:true});
await copyFile(resolve(source,'LICENSE'),resolve(target,'LICENSE'));
console.log('PDF preview assets prepared locally: '+version);
