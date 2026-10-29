import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomInt,createHmac,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync,readdirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fresh,act,score} from './model-v9.mjs';
import {CONTENT_V9 as C,ROOT} from './server.mjs';
import {annotatePresentation} from './response-presentation.mjs';
import {entryById,currentEntry,assertEntryAction} from './entry.mjs';
import {entryStatus} from './cohort-export.mjs';
import {PARTICIPATION,PARTICIPATION_VERSION} from './cohort-client.mjs';
import {followupPolicy,recordFollowupPolicy} from './followup-policy.mjs';
import {PILOT_CALENDAR} from './pilot-calendar.mjs';
export const DAY=86400000;
export const PROTOCOLS={PILOT:{version:'S3-PILOT-COMPRESSED-7D-v1',first_days:1,offsets:[0,2,4,5],followup_days:14,description:'压缩预测试：前测后至少1天开始，四课在首课计划日第1/3/5/6天；末课14天后追踪，不等同正式剂量'},FORMAL:{version:'S3-FORMAL-SPACED-4-v1',first_days:2,offsets:[0,3,7,10],followup_days:14,description:'正式待开放：前测后至少2天首课，第1/4/8/11天四课，实际末课14天后追踪'}};
export const CONSENT_VERSION=PARTICIPATION_VERSION;
export function materialDigest(){return createHash('sha256').update(JSON.stringify(C)).digest('hex');}
export function openCohortStore({dataDir,role,enabled=false,clock=()=>Date.now()}){
 if(!PROTOCOLS[role])throw Error('invalid cohort role');
 const path=resolve(dataDir??'');if(!dataDir||path==='/'||path===resolve(ROOT)||/study3-preview(?:\/|$)|thesis-app(?:\/|$)|\.data(?:\/|$)/.test(path))throw Error('必须使用独立的新数据目录');
 mkdirSync(path,{recursive:true,mode:0o700});if(realpathSync(path)!==path)throw Error('数据目录不得使用符号链接');chmodSync(path,0o700);
 const metaPath=join(path,'environment.json'),meta={schema:1,role,protocol:PROTOCOLS[role],material_sha256:materialDigest(),measurement:C.measurement_version};
 if(existsSync(metaPath)){if(JSON.stringify(JSON.parse(readFileSync(metaPath,'utf8')))!==JSON.stringify(meta))throw Error('环境身份、协议或材料发生变化，拒绝混用旧库');}
 else{if(readdirSync(path).some(n=>/sqlite|identity-key/.test(n)))throw Error('目录存在未核验的旧数据，拒绝自动迁移');writeFileSync(metaPath,JSON.stringify(meta),{flag:'wx',mode:0o600});}
 const originalFollowup=followupPolicy(role,PROTOCOLS[role]),followup=role==='PILOT'?PILOT_CALENDAR:originalFollowup;
 let amendment=null;
 if(role==='PILOT'){
  const amendmentPath=join(path,'followup-amendment-20261029.json');
  if(existsSync(amendmentPath)){
   amendment=JSON.parse(readFileSync(amendmentPath,'utf8'));
   if(JSON.stringify(amendment.policy)!==JSON.stringify(originalFollowup)||!Number.isFinite(Date.parse(amendment.activated_at)))throw Error('预测试后测修订记录不一致，拒绝启动');
  }else{
   amendment={policy:originalFollowup,activated_at:new Date(clock()).toISOString(),original_protocol_version:meta.protocol.version};
   writeFileSync(amendmentPath,JSON.stringify(amendment,null,2),{flag:'wx',mode:0o600});
  }
 }
 let calendarAmendment=null;
 if(role==='PILOT'){
  const calendarPath=join(path,'calendar-amendment-20261029.json');
  if(existsSync(calendarPath)){
   calendarAmendment=JSON.parse(readFileSync(calendarPath,'utf8'));
   if(JSON.stringify(calendarAmendment.policy)!==JSON.stringify(PILOT_CALENDAR)||!Number.isFinite(Date.parse(calendarAmendment.activated_at)))throw Error('预测试统一排期修订不一致，拒绝启动');
  }else{
   calendarAmendment={policy:PILOT_CALENDAR,activated_at:new Date(clock()).toISOString(),previous_followup_amendment:amendment};
   writeFileSync(calendarPath,JSON.stringify(calendarAmendment,null,2),{flag:'wx',mode:0o600});
  }
 }
 const keyPath=join(path,'cohort-key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});const key=readFileSync(keyPath);if(key.length!==32)throw Error('invalid key');
 const dbPath=join(path,'study3.sqlite'),db=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS codes(lookup TEXT PRIMARY KEY, pid TEXT UNIQUE); CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL)');
 db.exec("CREATE TABLE IF NOT EXISTS allocations(seq INTEGER PRIMARY KEY AUTOINCREMENT,pid TEXT NOT NULL UNIQUE,arm TEXT NOT NULL CHECK(arm IN ('A','B')))");
 db.exec('CREATE TABLE IF NOT EXISTS devices(token_hash TEXT PRIMARY KEY,pid TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS recovery(token_hash TEXT PRIMARY KEY,pid TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');
 const hash=n=>createHmac('sha256',key).update(role+'\0'+n).digest('hex');
 const normalize=n=>{if(typeof n!=='string')throw Error('测试号码请填本人学号');const x=n.normalize('NFKC').trim().toUpperCase();if(!/^[A-Z0-9]{4,24}$/.test(x)&&!new RegExp('^'+role+'-[A-F0-9]{24}$').test(x))throw Error('测试号码请填4至24位数字或英文字母组成的学号，保留开头的零，不填姓名');return x;};
 const numberLookup=n=>hash(/^[A-Z0-9]{4,24}$/.test(n)?'STUDENT-NUMBER\0'+n:n);
 const tokenHash=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t)?createHash('sha256').update(t).digest('hex'):null;
 const load=id=>{const row=db.prepare('SELECT state FROM participants WHERE id=?').get(id);if(!row)throw Error('记录不存在');return JSON.parse(row.state);};
 const all=()=>db.prepare('SELECT state FROM participants ORDER BY id').all().map(r=>JSON.parse(r.state));
 const save=(before,next)=>{const r=db.prepare('UPDATE participants SET revision=?,state=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),next.id,before.revision);if(r.changes!==1)throw Error('另一窗口已经保存，请刷新；原答未被覆盖');return next;};
 const store={role,enabled,protocol:PROTOCOLS[role],followupPolicy:followup,followupAmendment:amendment,calendarAmendment,db,load,all,close:()=>db.close(),
  issueCodes(count){if(!Number.isInteger(count)||count<1||count>500)throw Error('invalid count');if(role==='FORMAL'&&!enabled)throw Error('正式入口关闭，不能签发正式号码');const codes=[];db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<count;i++){const n=role+'-'+randomBytes(12).toString('hex').toUpperCase();db.prepare('INSERT INTO codes VALUES(?,NULL)').run(hash(n));codes.push(n);}db.exec('COMMIT');return codes;}catch(e){db.exec('ROLLBACK');throw e;}},
  deviceOwner(token){const h=tokenHash(token);if(!h)return null;const r=db.prepare('SELECT pid FROM devices WHERE token_hash=? AND expires>?').get(h,clock());return r?.pid??null;},
  grantDevice(pid,token){if(!tokenHash(token))throw Error('设备凭证无效');load(pid);db.prepare('INSERT INTO devices VALUES(?,?,?)').run(tokenHash(token),pid,clock()+60*DAY);},
  lookupNumber(number){const r=db.prepare('SELECT pid FROM codes WHERE lookup=?').get(numberLookup(normalize(number)));return r?.pid??null;},
  issueRecovery(number){const pid=store.lookupNumber(number);if(!pid)throw Error('该号码没有记录');const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO recovery VALUES(?,?,?,0)').run(tokenHash(token),pid,clock()+15*60000);return token;},
  enter(input,{devicePid=null}={}){
   if(!enabled)throw Error('本入口尚未开放，请等待组织者通知');const e=entryById(input.entry_id);if(!e)throw Error('请使用组织者发给你的具体环节链接');
   const code=normalize(input.test_number),numeric=/^[A-Z0-9]{4,24}$/.test(code),lookup=numberLookup(code);let row=db.prepare('SELECT pid FROM codes WHERE lookup=?').get(lookup);if(!numeric&&!row)throw Error('测试号码不在本次名单，请核对；未新建或更换记录');
   if(input.confirm_number!==true)throw Error('请先确认号码无误，之后每次均使用同号');
   if(row?.pid){
    if(numeric&&devicePid!==row.pid){
     const h=tokenHash(input.recovery),grant=h?db.prepare('SELECT pid FROM recovery WHERE token_hash=? AND expires>? AND used=0').get(h,clock()):null;
     if(!grant||grant.pid!==row.pid)throw Error('这个学号已有记录。请用首次填写时的设备和同一浏览器继续；换设备或清除浏览器数据后，请联系老师协助恢复，不会新建或覆盖回答。');
     db.exec('BEGIN IMMEDIATE');try{const used=db.prepare('UPDATE recovery SET used=1 WHERE token_hash=? AND used=0').run(h);if(used.changes!==1)throw Error('恢复链接已使用，请联系老师');db.prepare('DELETE FROM devices WHERE pid=?').run(row.pid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    }
    return {state:load(row.pid),created:false};
   }
   if(numeric&&devicePid)throw Error('当前浏览器已关联其他记录，请先核对原学号；确需多人共用设备或改错号时，请联系老师处理。');
   if(e.id!=='pre')throw Error('这个号码尚未做前测，请先使用前测链接；没有补造任何记录');
   if(input.consent!==CONSENT_VERSION)throw Error('请先阅读参加说明并确认自愿参加');
   const s=fresh();s.id=role+'-'+randomUUID();s.created_at=new Date(clock()).toISOString();s.data_role=role;s.not_research_data=false;s.environment=role;s.protocol=PROTOCOLS[role];s.material_sha256=meta.material_sha256;s.entry_started={pre:s.created_at};s.consent={version:CONSENT_VERSION,at:s.created_at,text:PARTICIPATION,text_sha256:createHash('sha256').update(PARTICIPATION).digest('hex')};
   db.exec('BEGIN IMMEDIATE');try{if(!row)db.prepare('INSERT INTO codes VALUES(?,NULL)').run(lookup);db.prepare('INSERT INTO participants VALUES(?,0,?)').run(s.id,JSON.stringify(s));const r=db.prepare('UPDATE codes SET pid=? WHERE lookup=? AND pid IS NULL').run(s.id,lookup);if(r.changes!==1)throw Error('记录同时被另一窗口建立，请重新进入');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {state:s,created:true};
  },
  policy(s){return recordFollowupPolicy(s,followup,store.protocol);},
  due(s,visit){
   if(visit===5){const p=store.policy(s);return p.basis==='fixed_group_calendar'?Date.parse(p.opens.post):Date.parse(s.visits[4]?.course_completed_at)+p.followup_days*DAY;}
   if(role==='PILOT'&&[3,4].includes(visit))return Date.parse(PILOT_CALENDAR.opens['practice-'+visit]);
   return Date.parse(s.baseline_at)+store.protocol.first_days*DAY+store.protocol.offsets[visit-1]*DAY;
  },
  apply(id,input){
   if(!enabled)throw Error('本入口尚未开放');const s=load(id),a=input.action,e=entryById(input.entry_id);
   if(input.revision!==s.revision||input.content_version!==s.version)throw Error('页面状态或版本已改变，请刷新；原答未覆盖');
   if(!a||typeof a.type!=='string')throw Error('缺少操作');
   if(Object.hasOwn(a,'demo_override')||a.type==='withdraw'||a.type==='exit')throw Error('本入口不接受演示快进或清除操作；停止参加可直接关闭，撤回请联系组织者');
   if(a.type==='visit'){
    if(!e||e.visit!==a.visit||!['waiting_first_course','dashboard'].includes(s.stage)||!s.baseline_at)throw Error('当前环节与进度不对应');
    const n=a.visit;if(![1,2,3,4,5].includes(n))throw Error('未知场次');
    if(entryStatus(s,e.id)==='completed')throw Error('本环节已完成，不重复作答');
    if(n<=4&&Array.from({length:n-1},(_,i)=>i+1).some(i=>!s.visits[i]?.course_completed_at))throw Error('请先完成前一次训练，再进入本次训练');
    if(n===5&&!s.visits[4]?.complete)throw Error('请先完成第四次训练和中测');
    const due=store.due(s,n);if(!Number.isFinite(due)||clock()<due)throw Error('尚未到本次日期，请于'+new Date(due).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'后进入');
    const next=structuredClone(s);next.visit=n;next.index=0;next.step=0;next.visits[n]={started_at:new Date(clock()).toISOString(),scheduled_at:new Date(due).toISOString(),complete:false};if(role==='PILOT'&&n>=3)next.visits[n].calendar_policy=PILOT_CALENDAR;next.entry_started[e.id]=new Date(clock()).toISOString();
    if(n===5){next.wave='T2';next.stage='general';next.visits[5].days_since_final_course=(clock()-Date.parse(s.visits[4].course_completed_at))/DAY;next.visits[5].followup_policy=store.policy(s);}else next.stage='course_orientation';
    next.events.push({type:'visit',visit:n,scheduled_at:new Date(due).toISOString(),at:new Date(clock()).toISOString()});next.revision++;return save(s,next);
   }
   if(!e)throw Error('缺少具体环节入口');assertEntryAction(s,e,a);
   if(a.type==='interval_end'&&clock()-s.interval.started_ms<180000)throw Error('共同间隔尚未结束，请按页面继续');
   const next=annotatePresentation(s,act(structuredClone(s),a,C,clock()),a,C);next.revision++;
   if(!s.baseline_at&&next.baseline_at){
    // New cohort allocations only: each pair randomly AB or BA, committed with
    // the first baseline completion. No changes to old technical assignments.
    db.exec('BEGIN IMMEDIATE');try{
     const last=db.prepare('SELECT seq,arm FROM allocations ORDER BY seq DESC LIMIT 1').get();
     const arm=!last||last.seq%2===0?(randomInt(2)===0?'A':'B'):(last.arm==='A'?'B':'A');
     const result=db.prepare('INSERT INTO allocations(pid,arm) VALUES(?,?)').run(s.id,arm);
     next.arm=arm;next.assignment={method:'server_crypto_random_permuted_pairs_1to1_v1',at:new Date(clock()).toISOString(),sequence:Number(result.lastInsertRowid),pair:Math.ceil(Number(result.lastInsertRowid)/2),allocation_basis:'order_of_first_completed_baseline',environment:role};
     next.first_course_scheduled_at=new Date(Date.parse(next.baseline_at)+store.protocol.first_days*DAY).toISOString();
     next.data_role=role;next.not_research_data=false;const saved=save(s,next);db.exec('COMMIT');return saved;
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(next.stage==='interval'&&!next.entry_started.mid)next.entry_started.mid=new Date(clock()).toISOString();
   next.data_role=role;next.not_research_data=false;return save(s,next);
  },
  view(s){return {state:s,scores:{...score(s),data_role:role,not_research_data:false},environment:role,collection_enabled:enabled,content_version:C.version,followup_policy:store.policy(s),followup_amendment:amendment,calendar_amendment:calendarAmendment};}
 };return store;
}
