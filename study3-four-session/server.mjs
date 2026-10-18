import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes,randomInt,randomUUID,createHmac,createCipheriv,createDecipheriv} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {act as actLegacy,score as scoreLegacy,VERSION as LEGACY_VERSION} from './model.mjs';
import {act as actV2,score as scoreV2,VERSION as V2_VERSION} from './model-v2.mjs';
import {act as actV3,score as scoreV3,VERSION as V3_VERSION} from './model-v3.mjs';
import {act as actV4,score as scoreV4,VERSION as V4_VERSION} from './model-v4.mjs';
import {act as actV5,score as scoreV5,VERSION as V5_VERSION} from './model-v5.mjs';
import {act as actV6,score as scoreV6,VERSION as V6_VERSION} from './model-v6.mjs';
import {act as actV7,score as scoreV7,VERSION as V7_VERSION} from './model-v7.mjs';
import {act as actV8,score as scoreV8,VERSION as V8_VERSION} from './model-v8.mjs';
import {fresh,act as actCurrent,score as scoreCurrent,VERSION as CURRENT_VERSION} from './model-v9.mjs';
import {deepenContent} from './training-v8.mjs';
import {sourceAdaptedContent} from './training-v9.mjs';
import {entryById,entryByPath,previewByPath,assertEntryAction} from './entry.mjs';
import {freshPreview,previewAction,previewView} from './preview.mjs';
import {annotatePresentation} from './response-presentation.mjs';
export const ROOT=fileURLToPath(new URL('./',import.meta.url));
export const CONTENT=JSON.parse(readFileSync(join(ROOT,'content.json'),'utf8'));
export const CONTENT_V2=JSON.parse(readFileSync(join(ROOT,'content-v2.json'),'utf8'));
export const CONTENT_V3=JSON.parse(readFileSync(join(ROOT,'content-v3.json'),'utf8'));
export const CONTENT_V4=JSON.parse(readFileSync(join(ROOT,'content-v4.json'),'utf8'));
export const CONTENT_V5=JSON.parse(readFileSync(join(ROOT,'content-v5.json'),'utf8'));
export const CONTENT_V6=JSON.parse(readFileSync(join(ROOT,'content-v6.json'),'utf8'));
export const CONTENT_V7=JSON.parse(readFileSync(join(ROOT,'content-v7.json'),'utf8'));
export const CONTENT_V8=deepenContent(CONTENT_V7);
export const CONTENT_V9=sourceAdaptedContent(CONTENT_V8,JSON.parse(readFileSync(join(ROOT,'source-courses-v9.json'),'utf8')));
const versions=new Map([[LEGACY_VERSION,{content:CONTENT,act:actLegacy,score:scoreLegacy}],[V2_VERSION,{content:CONTENT_V2,act:actV2,score:scoreV2}],[V3_VERSION,{content:CONTENT_V3,act:actV3,score:scoreV3}],[V4_VERSION,{content:CONTENT_V4,act:actV4,score:scoreV4}],[V5_VERSION,{content:CONTENT_V5,act:actV5,score:scoreV5}],[V6_VERSION,{content:CONTENT_V6,act:actV6,score:scoreV6}],[V7_VERSION,{content:CONTENT_V7,act:actV7,score:scoreV7}],[V8_VERSION,{content:CONTENT_V8,act:actV8,score:scoreV8}],[CURRENT_VERSION,{content:CONTENT_V9,act:actCurrent,score:scoreCurrent}]]);
function implementationFor(s){const impl=versions.get(s.version);if(!impl)throw Error('无法识别该记录的材料版本，请核对，不自动迁移');return impl;}
export function contentFor(s){return implementationFor(s).content;}
const actFor=s=>implementationFor(s).act;
const scoreFor=s=>implementationFor(s).score;
export function normalizeTestNumber(value){
 if(typeof value!=='string')throw Error('请填写测试号码，保留开头的零');
 const number=value.normalize('NFKC').trim().toUpperCase().replace(/^TEST-/, '');
 if(!/^[A-Z0-9-]{1,30}$/.test(number))throw Error('测试号码请用1—30位数字、字母或短横线');
 return number;
}
const csvCell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export function responseCSV(s){const rows=[['research_id','data_role','material_version','measurement_version','wave','item_id','value','missing_reason','submitted_at']];for(const [wave,answers] of Object.entries(s.responses))for(const [id,x] of Object.entries(answers))rows.push([s.id,'DEMO',s.version,s.measurement_version??'',wave,id,x.value,x.missing_reason,x.submitted_at]);return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
export function makeStore(dir,{newRecordFactory=fresh,previewVersion=CURRENT_VERSION}={}){
 mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 const keyPath=join(dir,'identity-key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});const key=readFileSync(keyPath);if(key.length!==32)throw Error('身份密钥无效');
 const identity=new DatabaseSync(join(dir,'identity.sqlite'));const answers=new DatabaseSync(join(dir,'answers.sqlite'));const previewAnswers=new DatabaseSync(join(dir,'preview-answers.sqlite'));
 for(const db of [identity,answers,previewAnswers]){db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;');}
 identity.exec('CREATE TABLE IF NOT EXISTS identity(lookup TEXT PRIMARY KEY,pid TEXT UNIQUE NOT NULL,blob TEXT NOT NULL,recovery TEXT NOT NULL)');
 identity.exec("CREATE TABLE IF NOT EXISTS preview_assignments(lookup TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,arm TEXT NOT NULL CHECK(arm IN ('A','B')),assigned_at TEXT NOT NULL,method TEXT NOT NULL)");
 // Add only material metadata, never rewrite existing answers or groups.
 if(!identity.prepare('PRAGMA table_info(preview_assignments)').all().some(x=>x.name==='material_version'))identity.exec("ALTER TABLE preview_assignments ADD COLUMN material_version TEXT NOT NULL DEFAULT 'S3-MD-4SESSION-DEMO-v0.4'");
 previewAnswers.exec('CREATE TABLE IF NOT EXISTS preview_states(id TEXT NOT NULL,entry TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(id,entry))');
 answers.exec('CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL)');
 identity.prepare('ATTACH DATABASE ? AS answer_store').run(join(dir,'answers.sqlite'));
 for(const file of ['identity.sqlite','answers.sqlite','preview-answers.sqlite'])chmodSync(join(dir,file),0o600);
 const hmac=s=>createHmac('sha256',key).update(s).digest('hex');
 const encrypt=obj=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')});};
 function decrypt(blob){const x=JSON.parse(blob),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));cipher.setAuthTag(Buffer.from(x.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(x.ciphertext,'base64')),cipher.final()]).toString());}
 const load=id=>{const r=answers.prepare('SELECT state FROM participants WHERE id=?').get(id);if(!r)throw Error('研究记录不存在');return JSON.parse(r.state);};
 const previewLoad=(id,entry)=>{const row=previewAnswers.prepare('SELECT state FROM preview_states WHERE id=? AND entry=?').get(id,entry);if(!row)throw Error('本环节试做记录不存在');return JSON.parse(row.state);};
 return {identity,answers,previewAnswers,key,decrypt,load,previewLoad,
  previewAssignment(input){const number=normalizeTestNumber(input.test_number),lookup=hmac('TECHNICAL-PREVIEW\0'+number);const prior=identity.prepare('SELECT id,arm,assigned_at,method,material_version FROM preview_assignments WHERE lookup=?').get(lookup);if(prior)return prior;
   const existing=identity.prepare('SELECT pid FROM identity WHERE lookup=?').get(hmac('DEMO\0TEST-'+number));
   const regular=existing?load(existing.pid):null;const arm=['A','B'].includes(regular?.arm)?regular.arm:randomInt(2)===0?'A':'B';const assigned_at=new Date().toISOString();
   identity.prepare('INSERT OR IGNORE INTO preview_assignments(lookup,id,arm,assigned_at,method,material_version) VALUES(?,?,?,?,?,?)').run(lookup,'PREVIEW-'+randomUUID(),arm,assigned_at,regular?.arm?'existing_cross_visit_group_reused_for_preview':'server_crypto_equal_probability_preview_number_bound',previewVersion);
   return identity.prepare('SELECT id,arm,assigned_at,method,material_version FROM preview_assignments WHERE lookup=?').get(lookup);
  },
  previewEnter(entry,assignment){let row=previewAnswers.prepare('SELECT state FROM preview_states WHERE id=? AND entry=?').get(assignment.id,entry);if(row)return JSON.parse(row.state);
   const state=freshPreview(entry,assignment.arm,assignment.material_version);state.id=assignment.id;state.preview_binding_id=assignment.id;state.material_versions=contentFor(state).material_versions;state.preview_assignment=assignment;if(state.arm)state.assignment=assignment;
   previewAnswers.prepare('INSERT OR IGNORE INTO preview_states VALUES(?,?,?,?)').run(state.id,entry,0,JSON.stringify(state));return previewLoad(state.id,entry);
  },
  previewApply(id,entry,input){const state=previewLoad(id,entry),next=annotatePresentation(state,previewAction(state,input,contentFor(state)),input.action,contentFor(state));const update=previewAnswers.prepare('UPDATE preview_states SET revision=?,state=? WHERE id=? AND entry=? AND revision=?').run(next.revision,JSON.stringify(next),id,entry,input.revision);if(update.changes!==1)throw Error('试做记录已在另一窗口更新，请刷新');return next;
  },
  // Only the loopback DEMO supports number-only access. Keep the old lookup
  // namespace so existing DEMO / TEST-number records resume without migration.
  enter(input){const number=normalizeTestNumber(input.test_number);const entry=entryById(input.entry_id);const lookup=hmac('DEMO\0TEST-'+number);const row=identity.prepare('SELECT * FROM identity WHERE lookup=?').get(lookup);
   if(row)return {state:load(row.pid),created:false};
   if(entry&&entry.id!=='pre')throw Error('这个测试号码还没有前测记录，请先使用前测链接填写同一号码；没有新建或补填记录');
   const s=newRecordFactory();contentFor(s);identity.exec('BEGIN IMMEDIATE');
   try{identity.prepare('INSERT INTO identity VALUES(?,?,?,?)').run(lookup,s.id,encrypt({test_number:number}), '');identity.prepare('INSERT INTO answer_store.participants VALUES(?,?,?)').run(s.id,0,JSON.stringify(s));identity.exec('COMMIT');}catch(e){identity.exec('ROLLBACK');throw e;}
   return {state:s,created:true};
  },
  apply(id,input){const s=load(id);if(!Number.isInteger(input.revision)||input.revision!==s.revision)throw Error('页面已在其他窗口更新，请刷新当前状态；没有覆盖首次回答');
   assertEntryAction(s,entryById(input.entry_id),input.action);
   if([CURRENT_VERSION,V8_VERSION,V7_VERSION,V6_VERSION,V5_VERSION,V4_VERSION,V3_VERSION,V2_VERSION].includes(s.version)&&input.content_version!==s.version)throw Error('题目版本已更新，请刷新页面；没有改写旧回答');
   const next=annotatePresentation(s,actFor(s)(structuredClone(s),input.action,contentFor(s)),input.action,contentFor(s));next.revision++;const r=answers.prepare('UPDATE participants SET revision=?,state=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),id,s.revision);if(r.changes!==1)throw Error('记录冲突，请刷新');return next;
  },
  revoke(id){const s=load(id);s.responses={T0:{},T1:{},T2:{},STATE:{},POST:{}};s.learning=[];s.trials=[];s.practice=[];s.checks=[];s.events=[{type:'demo_withdrawal',at:new Date().toISOString()}];s.withdrawn=true;s.stage='withdrawn';s.revision++;identity.prepare('DELETE FROM identity WHERE pid=?').run(id);answers.prepare('UPDATE participants SET state=?,revision=? WHERE id=?').run(JSON.stringify(s),s.revision,id);return s;},
  close(){identity.close();answers.close();previewAnswers.close();}
 };
}
export function makeServer({dataDir=join(ROOT,'.data'),newRecordFactory=fresh,previewVersion=CURRENT_VERSION}={}){
 const store=makeStore(dataDir,{newRecordFactory,previewVersion}),sessions=new Map(),previews=new Map(),fails=new Map();
 const server=createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
  const send=(code,obj,extra={})=>{res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(typeof obj==='string'?obj:JSON.stringify(obj));};
  try{
   if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host??''))return send(403,{error:'仅允许本机访问'});
   const origin='http://'+req.headers.host;if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'拒绝跨站请求'});
   const url=new URL(req.url,origin);if(url.search)return send(400,{error:'不要将测试号码放入网址'});
   const cookie=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('s3session='))?.slice(10);const session=sessions.get(cookie);const pid=session&&session.expires>Date.now()?session.pid:null;
   const previewCookie=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('s3preview='))?.slice(10);const cached=previews.get(previewCookie),preview=cached&&cached.expires>Date.now()?store.previewLoad(cached.state.id,cached.state.preview_entry):null;
   const view=s=>({state:s,scores:scoreFor(s)(s),content_version:contentFor(s).version,warning:['S3-GENERAL-23-CN-review-v1','S3-GENERAL-23-CN-review-v2'].includes(s.measurement_version)?'DEMO ONLY：23题中文项目稿已接入，未完成真人理解预测试，非正式收数。':'DEMO ONLY：旧版两份一般模块保留未测，不迁移或补填23题。'});
   if(req.method==='GET'){
    if(url.pathname==='/api/preview/content')return send(200,preview?contentFor(preview):versions.get(previewVersion).content);
    if(url.pathname==='/api/preview/state')return preview?send(200,previewView(preview)):send(401,{error:'请点击开始独立试做'});
    if(url.pathname==='/api/preview/export.json')return preview?send(200,previewView(preview),{'Content-Disposition':'attachment; filename="study3-TECHNICAL-PREVIEW.json"'}):send(401,{error:'请先开始独立试做'});
    if(url.pathname==='/api/preview/export.csv')return preview?send(200,responseCSV(preview),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="study3-TECHNICAL-PREVIEW.csv"'}):send(401,{error:'请先开始独立试做'});
    if(url.pathname==='/api/state')return pid?send(200,view(store.load(pid))):send(401,{error:'请填写测试号码进入'});
    if(url.pathname==='/api/content')return pid?send(200,contentFor(store.load(pid))):send(401,{error:'请先填写测试号码'});
    if(url.pathname==='/content.json')return send(200,pid?contentFor(store.load(pid)):contentFor(newRecordFactory()));
    if(url.pathname==='/api/export.json')return pid?send(200,{...view(store.load(pid)),export_role:'DEMO',contains_student_id:false},{'Content-Disposition':'attachment; filename="study3-DEMO.json"'}):send(401,{error:'请先进入测试'});
    if(url.pathname==='/api/export.csv')return pid?send(200,responseCSV(store.load(pid)),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="study3-DEMO-responses.csv"'}):send(401,{error:'请先进入测试'});
    const map={'/':'index.html','/study3-four-session/':'index.html','/app.mjs':'app.mjs','/entry.mjs':'entry.mjs','/response-presentation.mjs':'response-presentation.mjs','/workbench.mjs':'workbench.mjs','/readable-training.mjs':'readable-training.mjs','/application-training.mjs':'application-training.mjs','/source-training.mjs':'source-training.mjs','/reviewed-courses.mjs':'reviewed-courses.mjs','/source-progress.mjs':'source-progress.mjs','/styles.css':'styles.css','/content.json':'content.json','/study3-four-session/matched-preview/':'matched-preview.html'};const name=entryByPath(url.pathname)||previewByPath(url.pathname)?'index.html':map[url.pathname];if(!name)return send(404,{error:'没有正式或预测试路由'});
    res.writeHead(200,{...headers,'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8'});res.end(readFileSync(join(ROOT,name)));return;
   }
   if(req.method!=='POST')return send(405,{error:'不支持此操作'});
   if(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(403,{error:'提交须同源JSON请求'});
   let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>20000)return send(413,{error:'提交内容过大'});}const input=JSON.parse(body);
   if(url.pathname.startsWith('/api/preview/')){
    if(url.pathname==='/api/preview/start'){
     for(const [token,entry] of previews)if(entry.expires<Date.now())previews.delete(token);
     if(previews.size>=100&&!previews.has(previewCookie))return send(429,{error:'试做记录较多，请稍后再试'});
     if(!entryById(input.entry_id))throw Error('请选择本次环节');
     const assignment=store.previewAssignment(input),state=store.previewEnter(input.entry_id,assignment),token=randomBytes(32).toString('base64url');
     if(previewCookie)previews.delete(previewCookie);previews.set(token,{state,expires:Date.now()+4*3600000});
     return send(200,previewView(state),{'Set-Cookie':`s3preview=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`});
    }
    if(!preview)return send(401,{error:'独立试做已过期，请重新开始；跨次记录不受影响'});
    if(url.pathname==='/api/preview/action'){const next=store.previewApply(preview.id,preview.preview_entry,input);cached.state=next;return send(200,previewView(next));}
    if(url.pathname==='/api/preview/leave'){previews.delete(previewCookie);return send(200,{ok:true},{'Set-Cookie':'s3preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
    return send(404,{error:'没有此独立试做接口'});
   }
   if(url.pathname==='/api/enter'){
    entryById(input.entry_id);
    const address=req.socket.remoteAddress;const f=fails.get(address);if(f&&f.count>=10&&f.until>Date.now())return send(429,{error:'输入错误较多，请稍后再试'});
    let result;try{result=store.enter(input);}catch(e){const n=f&&f.until>Date.now()?f.count+1:1;fails.set(address,{count:n,until:Date.now()+60000});throw e;}
    fails.delete(address);if(cookie)sessions.delete(cookie);const token=randomBytes(32).toString('base64url');sessions.set(token,{pid:result.state.id,expires:Date.now()+4*3600000});
    return send(200,{...view(result.state),created:result.created},{'Set-Cookie':`s3session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`});
   }
   if(!pid)return send(401,{error:'页面已过期，请重新填写同一测试号码进入'});
   if(url.pathname==='/api/leave'){sessions.delete(cookie);return send(200,{ok:true},{'Set-Cookie':'s3session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
   if(url.pathname==='/api/withdraw'){if(input.confirm!=='WITHDRAW_DEMO')throw Error('需要确认撤回当前演示记录');const s=store.revoke(pid);sessions.delete(cookie);return send(200,view(s),{'Set-Cookie':'s3session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
   if(url.pathname==='/api/action'){const s=store.apply(pid,input);return send(200,view(s));}
   return send(404,{error:'未知测试接口'});
  }catch(e){send(400,{error:e.message==='Unexpected end of JSON input'?'请求内容不完整':String(e.message).slice(0,240)});}
 });
 return {server,store,sessions,previews};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server,store}=makeServer();const port=Number(process.env.S3_FOUR_DEMO_PORT||8784);
 server.listen(port,'127.0.0.1',()=>console.log(`研究三四次DEMO已启动：http://127.0.0.1:${port}/study3-four-session/\n仅虚拟测试号码，无登录步骤，不启动正式收数。`));
 const close=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGTERM',close);process.on('SIGINT',close);
}
