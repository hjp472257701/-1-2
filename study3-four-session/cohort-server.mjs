import {createServer} from 'node:http';
import {readFileSync,appendFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openCohortStore} from './cohort-store.mjs';
import {cohortSnapshot} from './cohort-export.mjs';
import {cohortSource} from './cohort-client.mjs';
import {researcherHandler} from './researcher-export.mjs';
import {CONTENT_V9 as C,ROOT} from './server.mjs';
import {ENTRIES,entryById} from './entry.mjs';
const files=new Set(['entry.mjs','app.mjs','response-presentation.mjs','workbench.mjs','readable-training.mjs','application-training.mjs','source-training.mjs','reviewed-courses.mjs','source-progress.mjs','styles.css']);
export function createCohortServer({origin,dataDir,role,enabled=false,clock}={}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('只允许无路径、无凭据的HTTPS origin');
 if(!['PILOT','FORMAL'].includes(role))throw Error('无法识别数据环境');
 const base='/study3/'+role.toLowerCase()+'/',store=openCohortStore({dataDir,role,enabled,clock}),sessions=new Map(),buckets=new Map();
 const researcher=researcherHandler({origin,dataDir,base,role,snapshot:()=>cohortSnapshot(store)});
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
 const cookieName='s3'+role.toLowerCase(),audit=(type,request_id)=>appendFileSync(join(dataDir,'service-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),type,request_id})+'\n',{mode:0o600});
 const server=createServer(async(req,res)=>{
  const request_id=randomBytes(8).toString('hex');
  const send=(code,value,type='application/json; charset=utf-8',extra={})=>{res.writeHead(code,{...headers,'Content-Type':type,'X-Request-Id':request_id,...extra});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
  try{
   if(req.headers.host!==url.host)return send(403,{error:'访问域名不匹配'});
   if(req.headers['x-forwarded-proto']&&req.headers['x-forwarded-proto']!=='https')return send(426,{error:'本活动必须使用加密链接'});
   if(req.headers.origin&&req.headers.origin!==url.origin)return send(403,{error:'拒绝跨站请求'});
   if(/[?#%]/.test(req.url??''))return send(400,{error:'链接不应包含号码或查询参数'});
   if(!req.url?.startsWith(base))return send(404,{error:'不是本环境入口'});
   const tail=req.url.slice(base.length);
   if(await researcher(req,res,tail))return;
   if(req.method==='GET'&&tail==='health')return send(200,{ok:true,study:3,environment:role,collection_enabled:enabled,formal_ready:false,protocol:store.protocol.version,followup_policy:store.followupPolicy,calendar_policy:store.calendarAmendment?.policy??null});
   const page=ENTRIES.find(e=>tail===e.id+'/');
   if(req.method==='GET'&&(page||!tail)){
    if(!enabled)return send(200,'<!doctype html><meta charset="utf-8"><title>研究三</title><h1>本活动尚未开放</h1><p>请等待组织者通知。没有收集或保存你的回答。</p>','text/html; charset=utf-8');
    if(!page)return send(200,'<!doctype html><meta charset="utf-8"><title>研究三</title><p>请使用组织者发给你的本次具体环节链接，不自行选择其他场次。</p>','text/html; charset=utf-8');
    return send(200,cohortSource('index.html',readFileSync(join(ROOT,'index.html'),'utf8'),base,role),'text/html; charset=utf-8');
   }
   if(req.method==='GET'&&files.has(tail))return send(200,cohortSource(tail,readFileSync(join(ROOT,tail),'utf8'),base,role),tail.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
   if(req.method==='GET'&&tail==='content.json')return send(200,C);
   if(!tail.startsWith('api/'))return send(404,{error:'接口不存在'});
   if(!enabled)return send(503,{error:'本活动尚未开放，未保存答卷'});
   const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1),session=sessions.get(token);
   const valid=session&&session.expires>Date.now();
   const deviceName=cookieName+'device',deviceToken=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(deviceName+'='))?.slice(deviceName.length+1);
   if(req.method==='GET'){
    if(tail==='api/content')return send(200,C);
    if(tail==='api/state')return valid?send(200,store.view(store.load(session.pid))):send(401,{error:'请重新填写同一测试号码，已保存进度不会丢失'});
    return send(404,{error:'没有参与者导出或技术试做接口'});
   }
   if(req.method!=='POST')return send(405,{error:'不支持此操作'});
   if(req.headers.origin!==url.origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(403,{error:'提交须同源JSON请求'});
   let body='',size=0;for await(const b of req){size+=b.length;if(size>20000)return send(413,{error:'请求过大'});body+=b;}const input=JSON.parse(body);
   if(tail==='api/enter'){
    // Aggregate loopback proxy limit with a generous ceiling; high entropy allowlist is primary protection.
    const now=Date.now(),address=req.socket.remoteAddress,old=buckets.get(address),bucket=!old||old.until<now?{n:0,until:now+60000}:old;buckets.set(address,bucket);if(++bucket.n>120)return send(429,{error:'进入次数过多，请一分钟后再试'});
    const x=store.enter(input,{devicePid:valid?session.pid:store.deviceOwner(deviceToken)});if(token)sessions.delete(token);for(const [t,s] of sessions)if(s.expires<now)sessions.delete(t);
    const next=randomBytes(32).toString('base64url');sessions.set(next,{pid:x.state.id,expires:now+4*3600000});audit(x.created?'participant_created':'participant_resumed',request_id);
    const device=randomBytes(32).toString('base64url');store.grantDevice(x.state.id,device);
    return send(200,{...store.view(x.state),created:x.created},undefined,{'Set-Cookie':[`${cookieName}=${next}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=14400`,`${deviceName}=${device}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=5184000`]});
   }
   if(!valid)return send(401,{error:'会话已过期，请填写同一号码恢复'});
   if(tail==='api/leave'){sessions.delete(token);return send(200,{ok:true},undefined,{'Set-Cookie':`${cookieName}=; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});}
   if(tail==='api/action'){entryById(input.entry_id);const s=store.apply(session.pid,input);return send(200,store.view(s));}
   return send(404,{error:'接口不存在'});
  }catch(e){audit('request_rejected',request_id);send(400,{error:String(e.message).slice(0,200),request_id});}
 });
 return {server,store,close:async()=>{if(server.listening)await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
 const role=process.env.S3_ENVIRONMENT,app=createCohortServer({origin:process.env.S3_PUBLIC_ORIGIN,dataDir:process.env.S3_DATA_DIR,role,enabled:process.env.S3_COLLECTION_ENABLED==='true'});
 app.server.listen(Number(process.env.S3_COHORT_PORT), '127.0.0.1',()=>console.log('Study 3 '+role+' isolated service started; enabled='+app.store.enabled));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
