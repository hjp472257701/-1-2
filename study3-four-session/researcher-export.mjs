// Study 3 only. Export immutable snapshots; never relabel technical records as formal data.
import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {ENTRIES} from './entry.mjs';
import {previewView} from './preview.mjs';
import {contentFor} from './server.mjs';
const ROLE='TECHNICAL_PREVIEW';
const cell=v=>'"'+(v==null?'':String(typeof v==='object'?JSON.stringify(v):v)).replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
const csv=rows=>'\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
const completed=s=>s.preview_entry==='pre'?s.stage==='waiting_first_course':s.preview_entry==='mid'?s.stage==='dashboard':s.preview_entry==='post'?s.stage==='finished':['dashboard','interval'].includes(s.stage);
function crc32(buffer){let crc=0xffffffff;for(const b of buffer){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function zipFiles(files){
 const chunks=[],directory=[];let offset=0;
 for(const [name,value] of Object.entries(files)){
  const file=Buffer.from(name),raw=Buffer.from(value),packed=deflateRawSync(raw),crc=crc32(raw);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(file.length,26);
  chunks.push(h,file,packed);
  const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(8,10);d.writeUInt16LE(33,14);d.writeUInt32LE(crc,16);d.writeUInt32LE(packed.length,20);d.writeUInt32LE(raw.length,24);d.writeUInt16LE(file.length,28);d.writeUInt32LE(offset,42);directory.push(d,file);offset+=h.length+file.length+packed.length;
 }
 const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,dir,end]);
}
export function exportSnapshot(store){
 // Synchronous read transactions: a request cannot interleave an action with this snapshot.
 store.previewAnswers.exec('BEGIN');
 let records;try{records=store.previewAnswers.prepare('SELECT state FROM preview_states ORDER BY id,entry').all().map(r=>JSON.parse(r.state));store.previewAnswers.exec('COMMIT');}catch(e){store.previewAnswers.exec('ROLLBACK');throw e;}
 const assignments=store.identity.prepare('SELECT id,arm,assigned_at,material_version FROM preview_assignments ORDER BY id').all();
 const manifest={schema:'S3-RESEARCHER-EXPORT-v1',study:3,data_role:ROLE,not_research_data:true,exported_at:new Date().toISOString(),participants:assignments.length,entry_records:records.length,contains_student_id:false,missing_policy:'未作答保持空值，未进入的环节不生成答卷',files:['overview.csv','responses-long.csv','responses-wide.csv','training.csv','trials.csv','events.csv','items.csv','complete-records.json','README.txt']};
 const overview=[['research_id','data_role','group','entry','wave','status','stage','revision','material_version','measurement_version','created_at','answered','skipped','scores_json']];
 const long=[['research_id','data_role','group','entry','wave','item_id','value','missing_reason','submitted_at','material_version','measurement_version']];
 const wideKeys=new Set();
 for(const s of records){const c=contentFor(s);for(const w of ['T0','T1','T2'])for(const item of c.generalItems)wideKeys.add(w+'__'+item.id);for(const [w,answers] of Object.entries(s.responses))for(const id of Object.keys(answers))wideKeys.add(w+'__'+id);}
 const columns=[...wideKeys].sort();
 const wide=[['research_id','data_role','group',...ENTRIES.map(e=>e.id+'__status'),...columns,...columns.map(k=>k+'__missing_reason')]];
 const training=[['research_id','data_role','group','entry','visit','course_record_json']];
 const trials=[['research_id','data_role','group','entry','kind','round','choice_selected','opportunity','executed_deduction','status','record_json']];
 const events=[['research_id','data_role','group','entry','kind','record_json']];
 const items=[['material_version','measurement_version','module','item_id','item_json']];const seen=new Set();
 for(const a of assignments)for(const e of ENTRIES){const s=records.find(s=>s.id===a.id&&s.preview_entry===e.id),responses=s?Object.values(s.responses).flatMap(x=>Object.values(x)):[];overview.push([a.id,ROLE,a.arm,e.id,e.wave??'',!s?'not_started':completed(s)?'completed':'in_progress',s?.stage??'',s?.revision??'',s?.version??a.material_version,s?.measurement_version??'',s?.created_at??'',responses.filter(x=>x.value!==null).length,responses.filter(x=>x.value===null).length,s?previewView(s).scores:null]);}
 for(const s of records){const group=s.preview_bound_arm??s.arm,base=[s.id,ROLE,group,s.preview_entry];
  for(const [wave,answers] of Object.entries(s.responses))for(const [id,x] of Object.entries(answers))long.push([...base,wave,id,x.value,x.missing_reason,x.submitted_at,s.version,s.measurement_version]);
  for(const row of s.learning)training.push([...base,row.visit,row]);
  for(const kind of ['practice','trials'])for(const t of s[kind])trials.push([...base,kind,t.round,t.choice_selected,t.opportunity,t.executed_deduction,t.status,t]);
  for(const kind of ['events','checks','visits'])for(const row of Object.values(s[kind]??{}))events.push([...base,kind,row]);
  if(!seen.has(s.version)){seen.add(s.version);const c=contentFor(s);for(const module of ['generalItems','stateItems','postItems'])for(const item of c[module]??[])items.push([s.version,s.measurement_version,module,item.id,item]);}
 }
 for(const a of assignments){const states=records.filter(s=>s.id===a.id),answers=new Map();for(const s of states)for(const [w,rows] of Object.entries(s.responses))for(const [id,x] of Object.entries(rows)){const k=w+'__'+id;if(answers.has(k))throw Error('同一身份同一波次存在重复题目，宽表无法唯一合并；未覆盖原答');answers.set(k,x);}wide.push([a.id,ROLE,a.arm,...ENTRIES.map(e=>{const s=states.find(s=>s.preview_entry===e.id);return !s?'not_started':completed(s)?'completed':'in_progress';}),...columns.map(k=>answers.get(k)?.value??null),...columns.map(k=>answers.has(k)?answers.get(k).missing_reason:'not_answered')]);}
 const full={manifest,assignments,records:records.map(s=>previewView(s))};
 return {manifest,overview:overview.slice(1).map(r=>Object.fromEntries(overview[0].map((k,i)=>[k,r[i]]))),files:{'overview.csv':csv(overview),'responses-long.csv':csv(long),'responses-wide.csv':csv(wide),'training.csv':csv(training),'trials.csv':csv(trials),'events.csv':csv(events),'items.csv':csv(items),'complete-records.json':JSON.stringify(full,null,2),'README.txt':'研究三技术测试导出，非正式研究样本。\n同一research_id关联七入口，group为服务端固定组别；未进入环节标记not_started，不补答。\nCSV为UTF-8 BOM；responses-long为逐题数据；wide保留各波次原始键；training保留所有首次/修改/应用记录；trials区分练习与七轮任务。\n完整JSON保留原状态和原分数中的DEMO标记，外层TECHNICAL_PREVIEW才是本环境身份，不转换为正式数据。\n未导出测试号码、身份密钥、身份查找哈希或研究一二数据。自由文本按CSV公式防护转义，原文见JSON。\nmanifest.json记录导出时间和数量。'}};
}
export function researcherHandler({store,origin,dataDir}){
 const sessions=new Map();let tries=0,until=0;
 const secure=new URL(origin).protocol==='https:';
 const audit=action=>appendFileSync(join(dataDir,'researcher-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),action})+'\n',{mode:0o600});
 return async(req,res,tail)=>{
  if(!tail.startsWith('researcher/'))return false;
  const send=(code,value,type='application/json; charset=utf-8',extra={})=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'",...extra});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
  if(!secure){send(503,{error:'研究者入口需要HTTPS加密访问，未开放明文登录'});return true;}
  const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('s3researcher='))?.slice(13),key=token?createHash('sha256').update(token).digest('hex'):null;
  const authenticated=key&&sessions.get(key)>Date.now();
  for(const [k,t] of sessions)if(t<=Date.now())sessions.delete(k);
  if(req.method==='GET'&&tail==='researcher/')send(200,readFileSync(new URL('./researcher.html',import.meta.url)),'text/html; charset=utf-8');
  else if(req.method==='GET'&&tail==='researcher/app.mjs')send(200,readFileSync(new URL('./researcher-app.mjs',import.meta.url)),'text/javascript; charset=utf-8');
  else if(req.method==='POST'&&['researcher/login','researcher/logout'].includes(tail)){
   if(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){send(403,{error:'拒绝跨站登录'});return true;}
   if(tail.endsWith('/logout')){sessions.delete(key);send(200,{ok:true},undefined,{'Set-Cookie':'s3researcher=; Path=/study3/researcher/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});return true;}
   let body='',size=0;for await(const b of req){size+=b.length;if(size>2048){send(413,{error:'请求过大'});return true;}body+=b;}
   if(Date.now()>until){tries=0;until=Date.now()+900000;}if(++tries>10){send(429,{error:'尝试过多，请15分钟后再试'});return true;}
   let password;try{password=JSON.parse(body).password;}catch{send(400,{error:'请求无效'});return true;}
   let config;try{config=JSON.parse(readFileSync(join(dataDir,'researcher-password.json'),'utf8'));}catch{send(503,{error:'研究者密码尚未配置'});return true;}
   if(typeof password!=='string'||password.length<12||password.length>256||!timingSafeEqual(scryptSync(password,config.salt,32),Buffer.from(config.hash,'hex'))){audit('login_failed');send(401,{error:'密码不正确'});return true;}
   const token=randomBytes(32).toString('base64url');sessions.set(createHash('sha256').update(token).digest('hex'),Date.now()+1800000);audit('login_success');send(200,{ok:true},undefined,{'Set-Cookie':'s3researcher='+token+'; Path=/study3/researcher/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800'});
  }else if(!authenticated)send(401,{error:'请先输入研究者密码'});
  else if(req.method==='GET'&&tail==='researcher/summary'){const x=exportSnapshot(store);send(200,{manifest:x.manifest,overview:x.overview});}
  else if(req.method==='GET'&&['researcher/export.zip','researcher/export.json'].includes(tail)){const x=exportSnapshot(store);audit(tail.endsWith('.zip')?'export_zip':'export_json');if(tail.endsWith('.zip'))send(200,zipFiles({...x.files,'manifest.json':JSON.stringify(x.manifest,null,2)}),'application/zip',{'Content-Disposition':'attachment; filename="study3-TECHNICAL-PREVIEW.zip"'});else send(200,x.files['complete-records.json'],'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="study3-TECHNICAL-PREVIEW.json"'});}
  else send(404,{error:'研究者接口不存在'});
  return true;
 };
}
