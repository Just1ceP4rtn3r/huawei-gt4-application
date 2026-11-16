// Keep the complete webpack runtime; compact only its private module identifiers.
const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'../../..');
const acorn=require(path.join(root,'tools/ohos-sdk/9/js/build-tools/ace-loader/node_modules/acorn'));
const esbuild=require(path.join(root,'tools/frida-agent/node_modules/esbuild'));
function walk(node,fn){if(!node || typeof node!=='object')return;fn(node);for(const key in node){const value=node[key];if(Array.isArray(value))for(const item of value)walk(item,fn);else if(value && typeof value==='object')walk(value,fn);}}
function compact(file){
    let text=fs.readFileSync(file,'utf8');const ast=acorn.parse(text,{ecmaVersion:2020}),ids=new Map(),changes=[];
    walk(ast,node=>{if(node.type==='VariableDeclarator' && node.id.name==='__webpack_modules__' && node.init && node.init.type==='ObjectExpression')for(const p of node.init.properties)if(typeof p.key.value==='string')ids.set(p.key.value,'m'+ids.size);});
    walk(ast,node=>{if(node.type==='Literal' && typeof node.value==='string' && ids.has(node.value))changes.push({start:node.start,end:node.end,value:JSON.stringify(ids.get(node.value))});});
    for(const c of changes.sort((a,b)=>b.start-a.start))text=text.slice(0,c.start)+c.value+text.slice(c.end);
    const result=esbuild.transformSync(text,{minify:true,target:'es5',legalComments:'none'});
    fs.writeFileSync(file,result.code);console.log('Compacted '+path.basename(file)+': '+ids.size+' private module IDs, '+result.code.length+' bytes');
}
function visit(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,f.name);if(f.isDirectory())visit(file);else if(f.name.endsWith('.js'))compact(file);}}
visit(process.argv[2]);
