// Isolated cloud TECHNICAL PREVIEW. Never enables formal collection.
import {createServer,request} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {makeServer} from './server.mjs';
import {ENTRIES} from './entry.mjs';
import {researcherHandler} from './researcher-export.mjs';
export const CLOUD_BASE='/study3/';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
const publicFiles=new Set(['app.mjs','entry.mjs','response-presentation.mjs','workbench.mjs','readable-training.mjs','application-training.mjs','source-training.mjs','reviewed-courses.mjs','source-progress.mjs','styles.css']);
const previewPages=new Set(ENTRIES.map(e=>'try/'+e.id+'/'));
const previewAPIs=new Set(['content','state','start','action','leave','export.json','export.csv']);
export function cloudSource(name,source){
 // Presentation only: keep entry IDs, wave keys, answers and researcher hub unchanged.
 if(['entry.mjs','app.mjs'].includes(name))source=source
  .replaceAll('中测 · 四次练习结束','问卷填写').replaceAll('中测 · 四次训练结束','问卷填写')
  .replaceAll('后测 · 结束两周后','问卷填写').replaceAll('前测 · 训练前','问卷填写')
  .replaceAll('前测','问卷填写').replaceAll('中测','问卷填写').replaceAll('后测','问卷填写');
 if(name==='entry.mjs')return source.replace("export const BASE='/study3-four-session/';","export const BASE='/study3/';");
 if(name==='index.html')return source.replaceAll('href="/','href="/study3/').replaceAll('src="/','src="/study3/').replace('本地测试环境','云端测试环境');
 if(name!=='app.mjs')return source;
 return source.replaceAll("from '/","from '/study3/")
  .replace("fetch(PREVIEW?'/api/preview/content':'/content.json')","fetch('/study3/api/preview/content')")
  .replace('fetch(path,{','fetch(\'/study3\'+path,{')
  .replaceAll('href="/api/','href="/study3/api/')
  .replaceAll('本地试做版','云端试做版')
  .replace('例如 TRYV91014','例如 CLOUDTEST-1018A');
}
export function hub(){return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>研究三 · 云端测试入口</title><link rel="stylesheet" href="/study3/styles.css"></head><body><main><h1>研究三 · 云端测试</h1><p class="warning">仅供研究者检查流程，不是正式收数。请勿填写真实学号、姓名或私人经历。</p><p>各环节可独立试做。请全程使用同一个虚拟测试号码，例如 CLOUDTEST-1018A；同号保留原组和已存进度。测试号码必须以 CLOUDTEST- 开头。</p><ul>'+ENTRIES.map(e=>'<li><a href="/study3/try/'+e.id+'/">'+e.label+'</a></li>').join('')+'</ul><p>实际研究顺序：前测 → 四次训练 → 中测 → 训练结束两周后的后测。这里允许直接打开各环节，仅用于技术检查。</p><p>正式收数：未开放。当前为v0.9模型、v47定稿文案。</p></main></body></html>';}
export async function createCloudPreview({origin,dataDir,maxAssignments=200,startLimit=30}={}){
 const publicURL=new URL(origin);
 if(!['http:','https:'].includes(publicURL.protocol)||publicURL.username||publicURL.password||publicURL.pathname!=='/'||publicURL.search||publicURL.hash)throw Error('必须设置不带路径和凭据的公开origin');
 if(!dataDir)throw Error('云端必须指定独立数据目录');
 const backend=makeServer({dataDir});
 const researcher=researcherHandler({store:backend.store,origin:publicURL.origin,dataDir});
 await new Promise((yes,no)=>{backend.server.once('error',no);backend.server.listen(0,'127.0.0.1',yes);});
 const port=backend.server.address().port,internalOrigin='http://127.0.0.1:'+port,buckets=new Map();
 const server=createServer(async(req,res)=>{
  const reply=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{...noStore,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
  try{
   if(req.headers.host!==publicURL.host)return reply(403,{error:'访问域名不匹配'});
   if(req.headers.origin&&req.headers.origin!==publicURL.origin)return reply(403,{error:'拒绝跨站请求'});
   if((req.url??'').includes('?')||(req.url??'').includes('#')||(req.url??'').includes('%'))return reply(400,{error:'请使用不带参数的测试链接'});
   const url=new URL(req.url,publicURL.origin);
   if(url.pathname==='/study3'&&req.method==='GET'){res.writeHead(302,{...noStore,Location:CLOUD_BASE});return res.end();}
   if(!url.pathname.startsWith(CLOUD_BASE))return reply(404,{error:'只提供研究三测试入口'});
   const tail=url.pathname.slice(CLOUD_BASE.length);
   if(await researcher(req,res,tail))return;
   if(tail==='health'&&req.method==='GET')return reply(200,{ok:true,study:3,mode:'cloud_technical_preview',formal_ready:false,model:'v0.9',copy:'v47'});
   if(!tail&&req.method==='GET')return reply(200,hub(),'text/html; charset=utf-8');
   const api=tail.startsWith('api/preview/')?tail.slice(12):null;
   const isAPI=api&&previewAPIs.has(api),isPage=previewPages.has(tail),isFile=publicFiles.has(tail);
   if(!isAPI&&!isPage&&!isFile)return reply(404,{error:'正式收数及其他接口未开放'});
   if(req.method!=='GET'&&req.method!=='POST')return reply(405,{error:'不支持此操作'});
   if(req.method==='POST'&&(!isAPI||!['start','action','leave'].includes(api)))return reply(405,{error:'不支持此操作'});
   let body='';
   if(req.method==='POST'){
    if(req.headers.origin!==publicURL.origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return reply(403,{error:'提交须同源JSON请求'});
    let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20000)return reply(413,{error:'提交内容过大'});body+=chunk.toString();}
    const input=JSON.parse(body);
    if(api==='start'){
     if(typeof input.test_number!=='string'||!/^CLOUDTEST-[A-Z0-9-]{4,20}$/.test(input.test_number.normalize('NFKC').trim().toUpperCase()))return reply(400,{error:'仅允许CLOUDTEST-开头的虚拟号码，请勿填写真实学号。'});
     const now=Date.now(),address=req.socket.remoteAddress;
     const bucket=buckets.get(address);const current=!bucket||bucket.until<now?{count:0,until:now+60000}:bucket;
     if(++current.count>startLimit)return reply(429,{error:'进入次数较多，请稍后再试'});buckets.set(address,current);
     // Hard test-cap; never clear old records to make room.
     if(backend.store.identity.prepare('SELECT COUNT(*) n FROM preview_assignments').get().n>=maxAssignments)return reply(429,{error:'云端试做容量已到上限，请联系研究者。已有记录未删除。'});
    }
   }
   const internalPath=isPage?'/study3-four-session/'+tail:isAPI?'/api/preview/'+api:'/'+tail;
   const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>/^s3cloudpreview=/.test(x)).map(x=>x.replace(/^s3cloudpreview=/,'s3preview=')).join('; ');
   const headers={Host:'127.0.0.1:'+port,...(cookies?{Cookie:cookies}:{}),...(req.method==='POST'?{Origin:internalOrigin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})};
   const upstream=request(internalOrigin+internalPath,{method:req.method,headers},incoming=>{
    let chunks=[],size=0;incoming.on('data',chunk=>{size+=chunk.length;if(size>2000000){incoming.destroy();return;}chunks.push(chunk);});
    incoming.on('end',()=>{
     let content=Buffer.concat(chunks),outHeaders={...noStore,'Content-Type':incoming.headers['content-type']??'application/json; charset=utf-8'};
     if(incoming.headers['content-disposition'])outHeaders['Content-Disposition']=incoming.headers['content-disposition'];
     if(incoming.headers['set-cookie'])outHeaders['Set-Cookie']=incoming.headers['set-cookie'].map(x=>x.replace(/^s3preview=/,'s3cloudpreview=').replace('Path=/;','Path=/study3/;')+(publicURL.protocol==='https:'?'; Secure':''));
     if(isPage||isFile&&tail.endsWith('.mjs'))content=Buffer.from(cloudSource(isPage?'index.html':tail,content.toString('utf8')));
     res.writeHead(incoming.statusCode,outHeaders);res.end(content);
    });
    incoming.on('error',()=>{if(!res.headersSent)reply(502,{error:'测试服务暂不可用'});else res.end();});
   });
   upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'测试服务暂不可用'});});upstream.end(body);
  }catch{if(!res.headersSent)reply(400,{error:'请求无效，测试记录未被自动补填'});}
 });
 const close=async()=>{if(server.listening)await new Promise(r=>server.close(r));await new Promise(r=>backend.server.close(r));backend.store.close();};
 return {server,close,backend};
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
 const app=await createCloudPreview({origin:process.env.S3_PUBLIC_ORIGIN,dataDir:process.env.S3_DATA_DIR});
 app.server.listen(Number(process.env.S3_CLOUD_PORT||8785),'127.0.0.1',()=>console.log('研究三云端技术试做已启动；正式收数关闭。'));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
