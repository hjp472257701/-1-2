import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,symlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createCloudPreview,cloudSource} from './cloud-preview.mjs';
const origin='http://study3.example.test';
const raw=(url,options={})=>new Promise((resolve,reject)=>{const req=request(url,options,res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const body=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>body,json:async()=>JSON.parse(body)});});});req.on('error',reject);req.end(options.body);});
async function fixture(options={}){
 const app=await createCloudPreview({origin,dataDir:mkdtempSync(join(tmpdir(),'s3-cloud-preview-')),...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const get=(path,headers={})=>raw(base+path,{headers:{Host:new URL(origin).host,...headers}});
 const post=(path,data,cookie='',extra={})=>raw(base+path,{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(data)});
 return {app,get,post};
}
test('云端七入口/总入口/资源隔离；正式入口和根API不可访问',async()=>{
 const {app,get}=await fixture();try{
  assert.equal((await get('/study3/')).status,200);assert.match(await(await get('/study3/')).text(),/CLOUDTEST-/);
  for(const id of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post']){const r=await get('/study3/try/'+id+'/');assert.equal(r.status,200);assert.match(await r.text(),/src="\/study3\/app.mjs"/);}
  for(const file of ['entry.mjs','app.mjs','source-training.mjs','reviewed-courses.mjs','styles.css'])assert.equal((await get('/study3/'+file)).status,200);
  assert.equal((await(await get('/study3/health')).json()).formal_ready,false);
  for(const path of ['/api/state','/questionnaire','/study3-formal/','/study3/measurement/pre/','/study3/api/enter','/study3/.data/identity-key','/study3/server.mjs'])assert.equal((await get(path)).status,404,path);
 }finally{await app.close();}
});
test('Host/Origin限制、URL参数禁用，真实学号和非测试号不写入数据库',async()=>{
 const {app,get,post}=await fixture();try{
  assert.equal((await get('/study3/',{Host:'evil.test'})).status,403);assert.equal((await get('/study3/?pid=123')).status,400);
  assert.equal((await post('/study3/api/preview/start',{entry_id:'pre',test_number:'CLOUDTEST-1234'},'',{Origin:'http://evil.test'})).status,403);
  for(const test_number of ['2026001234','OTHER001','CLOUDTEST-1'])assert.equal((await post('/study3/api/preview/start',{entry_id:'pre',test_number})).status,400);
  assert.equal(app.backend.store.identity.prepare('select count(*) n from preview_assignments').get().n,0);
 }finally{await app.close();}
});
test('云端Cookie隔离、同号码七入口绑定同组、提交/恢复/导出不含测试号码',async()=>{
 const {app,get,post}=await fixture();try{
  let id,arm;
  for(const entry_id of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post']){
   const r=await post('/study3/api/preview/start',{entry_id,test_number:'CLOUDTEST-HTTP1018'});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/s3cloudpreview=/);assert.match(cookie,/Path=\/study3\//);assert.match(cookie,/HttpOnly/);
   const state=(await r.json()).state;id??=state.id;arm??=state.preview_bound_arm;assert.equal(state.id,id);assert.equal(state.preview_bound_arm,arm);
   const session=cookie.split(';')[0];assert.equal((await get('/study3/api/preview/state',{Cookie:session})).status,200);
   if(entry_id==='pre'){
    const C=await(await get('/study3/api/preview/content',{Cookie:session})).json();
    const data={entry_id,content_version:state.version,revision:state.revision,action:{type:'answer',id:C.generalItems[0].id,value:3}};
    assert.equal((await post('/study3/api/preview/action',data,session)).status,200);assert.equal((await post('/study3/api/preview/action',data,session)).status,400);
    const restored=(await(await get('/study3/api/preview/state',{Cookie:session})).json()).state;assert.equal(restored.index,1);
   }
   const exp=await(await get('/study3/api/preview/export.json',{Cookie:session})).text();assert.ok(!exp.includes('CLOUDTEST-HTTP1018'));
  }
  assert.equal(app.backend.store.answers.prepare('select count(*) n from participants').get().n,0);
 }finally{await app.close();}
});
test('进入速率及测试容量上限，超限不删除已有记录',async()=>{
 const a=await fixture({startLimit:1});try{assert.equal((await a.post('/study3/api/preview/start',{entry_id:'pre',test_number:'CLOUDTEST-LIMIT01'})).status,200);assert.equal((await a.post('/study3/api/preview/start',{entry_id:'pre',test_number:'CLOUDTEST-LIMIT02'})).status,429);}finally{await a.app.close();}
 const b=await fixture({maxAssignments:1});try{assert.equal((await b.post('/study3/api/preview/start',{entry_id:'pre',test_number:'CLOUDTEST-CAP001'})).status,200);assert.equal((await b.post('/study3/api/preview/start',{entry_id:'pre',test_number:'CLOUDTEST-CAP002'})).status,429);assert.equal(b.app.backend.store.identity.prepare('select count(*) n from preview_assignments').get().n,1);}finally{await b.app.close();}
});
test('路径改写仅影响网页资源，原程序和测量不换；相对依赖保留',()=>{
 const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8');const out=cloudSource('app.mjs',source);assert.match(out,/fetch\('\/study3'\+path/);assert.ok(!out.includes("from '/entry.mjs'"));assert.ok(out.includes('云端试做版'));
 const entry=cloudSource('entry.mjs',readFileSync(new URL('./entry.mjs',import.meta.url),'utf8'));assert.match(entry,/BASE='\/study3\/'/);
 const copy=readFileSync(new URL('./source-training.mjs',import.meta.url),'utf8');assert.equal(cloudSource('source-training.mjs',copy),copy);
});
test('通过current符号链接启动时也实际监听，而非直接正常退出',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'s3-cloud-symlink-')),entry=join(dir,'current.mjs');symlinkSync(fileURLToPath(new URL('./cloud-preview.mjs',import.meta.url)),entry);
 const child=spawn(process.execPath,[entry],{env:{...process.env,S3_PUBLIC_ORIGIN:origin,S3_DATA_DIR:join(dir,'data'),S3_CLOUD_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{await new Promise((yes,no)=>{const timeout=setTimeout(()=>no(Error('符号链接启动超时')),5000);child.once('exit',code=>{clearTimeout(timeout);no(Error('启动后意外退出 '+code));});child.stdout.on('data',chunk=>{if(String(chunk).includes('研究三云端技术试做已启动')){clearTimeout(timeout);yes();}});child.once('error',no);});}
 finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
});
