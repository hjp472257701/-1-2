import * as V8 from './model-v8.mjs';
export const VERSION='S3-MD-4SESSION-DEMO-v0.9';
export const MEASUREMENT_VERSION=V8.MEASUREMENT_VERSION;
export const fresh=()=>({...V8.fresh(),version:VERSION});
export const score=V8.score;
const requireIt=(ok,message)=>{if(!ok)throw Error(message);};
const stamp=()=>new Date().toISOString();
const next=(s,stage)=>{s.stage=stage;s.step=0;s.index=0;};
export function validateWrites(w,count){
 requireIt(Array.isArray(w)&&w.length===count,'请填写本页回答或选择暂答状态');
 return w.map(x=>{requireIt(x&&['text','cant_think','skip'].includes(x.status),'书写状态无效');const text=typeof x.text==='string'?x.text.trim():'';requireIt(text.length<=400,'每项最多400字');requireIt(x.status!=='text'||text.length>0,'留空时请选择暂时想不到或暂不回答');return {status:x.status,text:x.status==='text'?text:''};});
}
const rowFor=s=>s.learning.find(x=>x.visit===s.visit);
function saveOnce(row,key,data){requireIt(!Object.hasOwn(row,key),'首次回答已锁定，不能覆盖');row[key]={...data,submitted_at:stamp()};}
export function act(s,a,c,now=Date.now()){
 requireIt(s.version===VERSION&&!s.withdrawn,'该版本已结束或已撤回');
 requireIt(c.version===VERSION&&c.measurement_version===MEASUREMENT_VERSION&&c.generalItems.length===23&&c.unavailableModules.length===0,'材料版本不匹配');
 requireIt(a&&typeof a.type==='string','缺少操作');
 const engagement=a.engagement;
 if(engagement)requireIt(Number.isInteger(engagement.active_ms)&&engagement.active_ms>=0&&engagement.active_ms<=3600000&&Number.isInteger(engagement.hidden_count)&&engagement.hidden_count>=0&&typeof engagement.resumed==='boolean','页面活动记录无效');
 const pageBefore=[s.stage,s.step,s.index].join(':'),wasCourse=s.stage.startsWith('course_');
 const logEngagement=()=>{if(engagement&&wasCourse)s.events.push({type:'page_engagement',visit:s.visit,page_before:pageBefore,active_ms:engagement.active_ms,hidden_count:engagement.hidden_count,resumed:engagement.resumed,measure:'visible_recent_interaction_estimate_not_effective_dose',at:stamp()});};
 if(a.type==='review_view'){
  requireIt(s.stage.startsWith('course_'),'仅课程可以回看');
  const allowed=['story'];const row=rowFor(s);
  if(row?.initial)allowed.push('teaching');
  if(row?.change&&!(s.stage==='course_change'&&s.step===0))allowed.push('change');
  requireIt(allowed.includes(a.section),'这部分尚未学习，不提前展示参考');
  logEngagement();s.events.push({type:'review_view',visit:s.visit,section:a.section,at:stamp()});return s;
 }
 // Timing logs record visible active intervals only, never total training dose.
 if(a.type==='engagement'){
  requireIt(s.stage.startsWith('course_')&&a.stage===s.stage&&a.step===s.step&&a.index===s.index,'页面已变化');
  requireIt(Number.isInteger(a.active_ms)&&a.active_ms>=0&&a.active_ms<=3600000,'活动时长无效');
  requireIt(['submit','hidden','pause','leave'].includes(a.reason),'活动事件无效');
  s.events.push({type:'engagement',visit:s.visit,stage:s.stage,step:s.step,index:s.index,active_ms:a.active_ms,reason:a.reason,measure:'client_visible_recent_interaction_estimate_not_effective_dose',at:stamp()});return s;
 }
 if(!s.stage.startsWith('course_')||['pause','exit','withdraw'].includes(a.type)){
  const copy={...structuredClone(s),version:V8.VERSION};
  const result=V8.act(copy,a,{...c,version:V8.VERSION},now);result.version=VERSION;Object.assign(s,result);logEngagement();return s;
 }
 const course=c.groups[s.arm]?.[s.visit-1];requireIt(course,'课程不存在');
 const row=rowFor(s);
 if(s.stage==='course_orientation'){
  requireIt(a.type==='continue','请按当前页面继续');requireIt(!row,'本次学习已经开始');
  s.learning.push({id:course.id,visit:s.visit,training_version:c.material_versions.training,assessment_status:'unscored_practice_not_validated_outcome',first_response_locked:true,started_at:stamp()});
  next(s,s.visit>1?'course_review':'course_source');
 }else if(s.stage==='course_review'){
  requireIt(a.type==='course_review','请先回顾或明确跳过');
  requireIt(['real','simulated','none','unsure','skip'].includes(a.practice_status),'请选择实际练习情况');
  const writes=validateWrites(a.writes,1);
  saveOnce(row,'review',{practice_status:a.practice_status,writes,previous_record_available:!s.preview_only&&Boolean(s.visits[s.visit-1]?.course_completed_at)});next(s,'course_source');
 }else if(s.stage==='course_source'){
  requireIt(a.type==='continue','请按当前页面继续');next(s,'course_initial');
 }else if(s.stage==='course_initial'){
  requireIt(a.type==='course_initial','请先保存自己的回答');saveOnce(row,'initial',{writes:validateWrites(a.writes,2)});next(s,'course_teaching');
 }else if(s.stage==='course_teaching'){
  requireIt(a.type==='continue','请按当前页面继续');row.teaching_viewed_at=stamp();next(s,'course_change');
 }else if(s.stage==='course_change'){
  if(s.step===0){requireIt(a.type==='course_change','请先保存自己的判断');saveOnce(row,'change',{writes:validateWrites(a.writes,1)});s.step=1;}
  else {requireIt(a.type==='continue','请阅读讲解后继续');row.change_feedback_viewed_at=stamp();next(s,'course_reflection');}
 }else if(s.stage==='course_reflection'){
  requireIt(a.type==='continue'&&Object.keys(a).every(k=>['type','engagement','page_before'].includes(k)),'私下反思不接收文字或经历');next(s,'course_application');
 }else if(s.stage==='course_application'){
  requireIt(a.type==='course_application','请先保存自己的回答');saveOnce(row,'application',{writes:validateWrites(a.writes,2)});next(s,'course_revision');
 }else if(s.stage==='course_revision'){
  requireIt(a.type==='course_revision'&&['keep','revise'].includes(a.mode),'请选择保留原答或另写修订');
  const writes=validateWrites(a.writes,1);requireIt(a.mode!=='revise'||writes[0].status==='text','选择修订时请写下新回答；也可选择保留原答');
  saveOnce(row,'revision',{mode:a.mode,writes});row.application_feedback_viewed_at=stamp();next(s,'course_card');
 }else if(s.stage==='course_card'){
  requireIt(a.type==='course_card','请保存学习卡或明确跳过');saveOnce(row,'card',{writes:validateWrites(a.writes,1)});row.experience={};next(s,'course_experience');
 }else if(s.stage==='course_experience'){
  const q=c.course_experience[s.index];requireIt(a.type==='course_experience'&&a.id===q.id,'体验题状态已变化');
  requireIt(a.value===null||(Number.isInteger(a.value)&&a.value>=1&&a.value<=5),'选项超出范围');
  saveOnce(row.experience,q.id,{value:a.value,missing_reason:a.value===null?'active_skip':null});s.index++;if(s.index===5)next(s,'course_comment');
 }else if(s.stage==='course_comment'){
  requireIt(a.type==='course_comment','请保存反馈或跳过');saveOnce(row,'comment',{writes:validateWrites(a.writes,1)});next(s,'course_end');
 }else if(s.stage==='course_end'){
  requireIt(a.type==='continue','请按当前页面继续');row.ended_at=stamp();s.visits[s.visit].course_completed_at=stamp();
  if(s.visit===4){s.interval={started_ms:now,started_at:stamp(),duration_ms:180000,actions:[]};next(s,'interval');}
  else {s.visits[s.visit].complete=true;s.visits[s.visit].ended_at=stamp();next(s,'dashboard');}
 }else throw Error('未知课程页面，不自动跳过');
 logEngagement();s.events.push({type:a.type,visit:s.visit,stage_after:s.stage,at:stamp()});return s;
}
