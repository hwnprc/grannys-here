import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'VENDORED_SOURCE.json'),'utf8'));
const kit=join(root,'vexo-open-kit');
// Never change or replace an existing kit checkout.
if(!existsSync(kit)){
  execFileSync('git',['clone','--no-checkout',`${manifest.repository}.git`,kit],{stdio:'inherit'});
  execFileSync('git',['-C',kit,'checkout','--detach',manifest.commit],{stdio:'inherit'});
}
for(const file of manifest.files){
  const data=readFileSync(join(kit,file.path));
  const sha=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if(sha!==file.sha)throw new Error(`SDK mismatch: ${file.path}. Expected commit ${manifest.commit}; existing files have been left unchanged.`);
}
console.log(`Vexo kit verified at ${manifest.commit}. No SDK files were modified.`);
