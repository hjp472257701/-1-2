import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request} from 'node:http';
import {runInNewContext} from 'node:vm';
import {projectPortal,unifiedAdmin,fetchOriginalAdmin} from './project-portal.mjs';
import {createCloudPreview} from './cloud-preview.mjs';
const source=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const template=source.slice(source.indexOf("app.get('/admin'")).match(/res.send\(`([\s\S]*?)`\)/)[1];
const original=runInNewContext('`'+template+'`');
const script=html=>[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
test('统一管理保留原全部下载与邀请脚本，不连接数据库或转发旧口令',()=>{
 const x=unifiedAdmin(original,{secure:true,origin:'https://study3.test'});
 assert.deepEqual(script(x.html),script(original));
 for(const id of [...original.matchAll(/id="(download[^"]+)"/g)].map(x=>x[1]))assert.equal((x.html.match(new RegExp('id="'+id+'"','g'))??[]).length,1,id);
 assert.match(x.html,/src="\/study3\/researcher\/"/);assert.match(x.html,/统一下载管理/);assert.match(x.headers['Content-Security-Policy'],/nonce-/);assert.doesNotMatch(x.headers['Content-Security-Policy'],/script-src[^;]*unsafe-inline/);
 assert.equal((x.html.match(/id="study3-management"/g)??[]).length,1);
 for(const env of ['pilot','formal']){assert.match(x.html,new RegExp('src="/study3/'+env+'/researcher/"'));for(const id of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post'])assert.match(x.html,new RegExp('href="/study3/'+env+'/'+id+'/"'));}assert.match(x.html,/正式研究（尚未开放）/);
 const http=unifiedAdmin(original,{secure:false,origin:'https://study3.test'});assert.doesNotMatch(http.html,/<iframe/);assert.match(http.html,/https:\/\/study3.test\/admin/);assert.deepEqual(script(http.html),script(original));
 for(const page of [x.html,http.html]){for(const entry of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post'])assert.equal((page.match(new RegExp('href="/study3/try/'+entry+'/"','g'))??[]).length,1,entry);assert.match(page,/正式收数未开放/);assert.match(page,/aria-label="研究三七个测试入口"/);}
 assert.throws(()=>unifiedAdmin('<html>unexpected</html>',{secure:true,origin:'https://study3.test'}));
 assert.throws(()=>fetchOriginalAdmin('http://evil.example/admin'));
});
test('三个研究总入口保留原四路径和研究三七链接，不把总目录发给参与者',()=>{const html=projectPortal();for(const path of ['/questionnaire','/','/online-points','/online-points-formal','/admin',...['pre','practice-1','practice-2','practice-3','practice-4','mid','post'].map(x=>'/study3/try/'+x+'/')])assert.ok(html.includes('href="'+path+'"'),path);assert.match(html,/每次只把对应环节链接/);assert.match(html,/正式收数未开放/);});
test('统一入口HTTP真实代理只读原管理HTML；旧API不经过研究三、答卷和分组不改',async()=>{
 const calls=[];const legacy=createServer((req,res)=>{calls.push({path:req.url,auth:req.headers.authorization,cookie:req.headers.cookie});res.writeHead(200,{'Content-Type':'text/html'});res.end(original);});await new Promise(r=>legacy.listen(0,'127.0.0.1',r));
 const app=await createCloudPreview({origin:'https://study3.test',dataDir:mkdtempSync(join(tmpdir(),'s3-portal-')),legacyAdminURL:'http://127.0.0.1:'+legacy.address().port+'/admin'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const a=app.backend.store.previewAssignment({test_number:'CLOUDTEST-PORTAL001'});for(const id of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post'])app.backend.store.previewEnter(id,a);
 const before=app.backend.store.previewAnswers.prepare('SELECT * FROM preview_states ORDER BY id,entry').all();
 const get=(path,extra={})=>new Promise((yes,no)=>{const q=request('http://127.0.0.1:'+app.server.address().port+path,{headers:{Host:'study3.test',...extra}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>yes({status:res.statusCode,body,headers:res.headers}));});q.on('error',no);q.end();});
 try{const admin=await get('/admin',{Authorization:'Bearer TEST-NOT-A-REAL-TOKEN',Cookie:'s3researcher=fixture'});assert.equal(admin.status,200);assert.match(admin.body,/<iframe/);assert.deepEqual(calls,[{path:'/admin',auth:undefined,cookie:undefined}]);
  assert.equal((await get('/studies/')).status,200);assert.equal((await get('/api/export.csv')).status,404);assert.equal((await get('/admin?token=fixture')).status,400);assert.equal(calls.length,1);
  const legacyHTTP=await get('/admin',{'X-Forwarded-Proto':'http'});assert.equal(legacyHTTP.status,200);assert.doesNotMatch(legacyHTTP.body,/<iframe/);
  assert.deepEqual(app.backend.store.previewAnswers.prepare('SELECT * FROM preview_states ORDER BY id,entry').all(),before);assert.equal(app.backend.store.identity.prepare('SELECT count(*) n FROM preview_assignments').get().n,1);
 }finally{await app.close();await new Promise(r=>legacy.close(r));}
});
