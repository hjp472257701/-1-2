import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync} from 'node:crypto';
import {request} from 'node:http';
import {inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {createCloudPreview} from './cloud-preview.mjs';
import {exportSnapshot,zipFiles} from './researcher-export.mjs';
const origin='https://study3.example.test';
const password='TEST-ONLY-password-for-fixture';
function unzip(buf){const files={};let n=0;while(buf.readUInt32LE(n)===0x04034b50){const size=buf.readUInt32LE(n+18),nl=buf.readUInt16LE(n+26),el=buf.readUInt16LE(n+28),name=buf.subarray(n+30,n+30+nl).toString(),start=n+30+nl+el;files[name]=inflateRawSync(buf.subarray(start,start+size)).toString();n=start+size;}return files;}
const raw=(base,path,method='GET',body=null,cookie='',extra={})=>new Promise((yes,no)=>{const req=request(base+path,{method,headers:{Host:'study3.example.test',...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{}),Cookie:cookie,...extra}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>yes({status:res.statusCode,cookie:res.headers['set-cookie']?.[0].split(';')[0],headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',no);req.end(body?JSON.stringify(body):undefined);});
async function fixture(dir=mkdtempSync(join(tmpdir(),'s3-researcher-'))){const salt='fixture-salt';try{writeFileSync(join(dir,'researcher-password.json'),JSON.stringify({salt,hash:scryptSync(password,salt,32).toString('hex')}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}const app=await createCloudPreview({origin,dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;return {app,dir,get:(p,c='')=>raw(base,'/study3/researcher/'+p,'GET',null,c),post:(p,b,c='',extra={})=>raw(base,'/study3/researcher/'+p,'POST',b,c,extra)};}
test('研究者保护：匿名/学生Cookie不能批量导出；密码/同源/退出/限流',async()=>{const f=await fixture();try{
 assert.equal((await f.get('')).status,200);assert.equal((await f.get('export.zip')).status,401);assert.equal((await f.get('summary','s3cloudpreview=anything')).status,401);
 assert.equal((await f.post('login',{password},'',{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.post('login',{password:'incorrect-password'})).status,401);
 const login=await f.post('login',{password});assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await f.get('summary',login.cookie)).status,200);await f.post('logout',{},login.cookie);assert.equal((await f.get('summary',login.cookie)).status,401);
 for(let i=0;i<12;i++)await f.post('login',{password:'incorrect-password'});assert.equal((await f.post('login',{password})).status,429);
 }finally{await f.app.close();}});
test('七入口汇总：缺答/零分/未进入、同号同组、完整训练原答与CSV公式保护；原库只读',async()=>{const f=await fixture();try{
 const a=f.app.backend.store.previewAssignment({test_number:'CLOUDTEST-EXPORT01'});for(const id of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post'])f.app.backend.store.previewEnter(id,a);
 const s=f.app.backend.store.previewLoad(a.id,'mid');s.responses.T1={MD8_01:{value:null,missing_reason:'active_skip',submitted_at:'2026-10-22T00:00:00Z'},AQR12_01:{value:1,missing_reason:null,submitted_at:'2026-10-22T00:00:00Z'}};s.learning=[{visit:1,initial:{writes:[{text:'=SUM(1,2)\n"quoted"中文',status:'text'}]},revised:{text:'保留原答'}}];s.trials=[{round:1,choice_selected:0,executed_deduction:0,status:'complete'}];s.practice=[{round:1,choice_selected:2}];s.events=[{type:'fixture',at:'test'}];
 f.app.backend.store.previewAnswers.prepare('UPDATE preview_states SET state=? WHERE id=? AND entry=?').run(JSON.stringify(s),s.id,'mid');
 const b=f.app.backend.store.previewAssignment({test_number:'CLOUDTEST-EXPORT02'});f.app.backend.store.previewEnter('pre',b);
 const before=f.app.backend.store.previewAnswers.prepare('SELECT state FROM preview_states ORDER BY id,entry').all();const x=exportSnapshot(f.app.backend.store);assert.equal(x.manifest.entry_records,8);assert.equal(x.overview.length,14);assert.equal(x.overview.filter(r=>r.status==='not_started').length,6);
 assert.ok(x.overview.filter(r=>r.research_id===a.id).every(r=>r.group===a.arm));assert.match(x.files['responses-long.csv'],/active_skip/);assert.match(x.files['trials.csv'],/"0"/);assert.ok(!JSON.stringify(x).includes('CLOUDTEST-EXPORT01'));assert.ok(!JSON.stringify(x).includes('lookup'));
 const full=JSON.parse(x.files['complete-records.json']);assert.equal(full.records.find(r=>r.state.preview_entry==='mid').state.learning[0].initial.writes[0].text,s.learning[0].initial.writes[0].text);assert.ok(full.manifest.not_research_data);assert.deepEqual(f.app.backend.store.previewAnswers.prepare('SELECT state FROM preview_states ORDER BY id,entry').all(),before);assert.equal(f.app.backend.store.answers.prepare('SELECT count(*) n FROM participants').get().n,0);
 const archive=zipFiles({...x.files,'manifest.json':JSON.stringify(x.manifest)}),archivePath=join(f.dir,'acceptance.zip');writeFileSync(archivePath,archive);execFileSync('unzip',['-t',archivePath]);
 const zip=unzip(archive);assert.equal(Object.keys(zip).length,10);assert.equal(zip['training.csv'],x.files['training.csv']);assert.ok(zip['responses-long.csv'].startsWith('\uFEFF'));assert.match(zip['responses-wide.csv'],/T0__PRDS3_01/);assert.equal(zip['responses-wide.csv'].split('\r\n').length,3);assert.equal(JSON.parse(zip['manifest.json']).entry_records,8);
 const login=await f.post('login',{password});const download=await f.get('export.zip',login.cookie);assert.equal(download.status,200);assert.equal(download.headers['content-type'],'application/zip');assert.equal(JSON.parse(unzip(download.body)['manifest.json']).entry_records,8);
 }finally{await f.app.close();}});
test('服务重启后导出记录保持、旧管理会话失效；空库能导出表头',async()=>{let f=await fixture();const dir=f.dir;const a=f.app.backend.store.previewAssignment({test_number:'CLOUDTEST-RESTART'});f.app.backend.store.previewEnter('post',a);const login=await f.post('login',{password});await f.app.close();f=await fixture(dir);try{assert.equal((await f.get('summary',login.cookie)).status,401);const l=await f.post('login',{password});const x=JSON.parse((await f.get('summary',l.cookie)).body);assert.equal(x.manifest.entry_records,1);assert.equal(x.overview.filter(r=>r.status==='not_started').length,6);}finally{await f.app.close();}
 const empty=await fixture();try{const x=exportSnapshot(empty.app.backend.store);assert.equal(x.manifest.participants,0);assert.ok(x.files['responses-long.csv'].includes('research_id'));}finally{await empty.app.close();}});
test('HTTPS环境保留HTTP虚拟测试兼容，但拒绝明文管理登录',async()=>{const f=await fixture();try{const base='http://127.0.0.1:'+f.app.server.address().port;const r=await raw(base,'/study3/api/preview/start','POST',{entry_id:'pre',test_number:'CLOUDTEST-LEGACYHTTP'},'',{Origin:'http://study3.example.test','X-Forwarded-Proto':'http'});assert.equal(r.status,200);assert.ok(!r.headers['set-cookie'][0].includes('Secure'));assert.equal((await f.post('login',{password},'',{Origin:'http://study3.example.test','X-Forwarded-Proto':'http'})).status,426);}finally{await f.app.close();}});
