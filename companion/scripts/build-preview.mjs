// Creates a self-contained offline preview without installing a bundler or changing SDK files.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,relative,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
async function collect(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())await collect(path);else if(item.name.endsWith('.js'))files.push(path);}}
await collect(join(root,'public'));await collect(join(root,'vexo-open-kit/js/src'));files.push(join(root,'vexo-open-kit/dashboard/speech/deepgram.js'));
const imports={};
const key=p=>'before-i-forget/'+relative(root,p).split('\\').join('/');
for(const file of files){let source=await readFile(file,'utf8');source=source.replace(/^((?:import|export)\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/gm,(_all,from,quote,specifier)=>`${from}${quote}${key(resolve(dirname(file),specifier))}${quote}`);imports[key(file)]='data:text/javascript;base64,'+Buffer.from(source).toString('base64');}
let html=await readFile(join(root,'public/vexo.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="/vexo.css">',`<style>${await readFile(join(root,'public/base.css'),'utf8')}\n${(await readFile(join(root,'public/vexo.css'),'utf8')).replace(/@import[^;]+;/g,'')}</style>`);
html=html.replace('<script type="module" src="/vexo-ui.js"></script>',`<script type="importmap">${JSON.stringify({imports}).replace(/</g,'\\u003c')}</script><script type="module">import 'before-i-forget/public/vexo-ui.js';</script>`);
await mkdir(join(root,'dist'),{recursive:true});await writeFile(join(root,'dist/Before_I_Forget_Demo.html'),html);
console.log('Created dist/Before_I_Forget_Demo.html — offline demo; hardware and GPS disabled.');
