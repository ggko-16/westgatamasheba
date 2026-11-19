import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {transform} from 'esbuild';

// Serve only the compiled frontend; server functions, source maps and project files stay outside dist.
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true,force:true});
for(const file of ['app.js','admin.js','api.js']){
  const source=await readFile(`public/${file}`,'utf8');
  const result=await transform(source,{minify:true,loader:'js',format:'esm',target:'es2020',sourcemap:false,legalComments:'inline'});
  await writeFile(`dist/${file}`,result.code);
}
