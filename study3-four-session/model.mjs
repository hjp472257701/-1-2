import {randomInt,randomUUID} from 'node:crypto';
export const VERSION='S3-MD-4SESSION-DEMO-v0.1';
export function fresh(){return {version:VERSION,id:'DEMO-'+randomUUID(),data_role:'DEMO',not_research_data:true,arm:null,stage:'eligibility',visit:0,index:0,step:0,revision:0,created_at:new Date().toISOString(),eligibility:null,baseline_at:null,responses:{T0:{},T1:{},T2:{},STATE:{},POST:{}},unavailable:{},learning:[],visits:{},checks:[],trials:[],practice:[],events:[],withdrawn:false};}
const requireIt=(ok,message)=>{if(!ok)throw new Error(message);};
const stamp=()=>new Date().toISOString();
const val=(v,min,max)=>requireIt(v===null||(Number.isInteger(v)&&v>=min&&v<=max),'选项超出范围');
function record(s,wave,id,value){requireIt(!Object.hasOwn(s.responses[wave],id),'首次作答已锁定');s.responses[wave][id]={value,missing_reason:value===null?'active_skip':null,submitted_at:stamp()};}
const next=(s,stage)=>{s.stage=stage;s.index=0;s.step=0;};
export function score(s){const complete=(values,n)=>values.length===n&&values.every(v=>Number.isFinite(v))?values.reduce((a,b)=>a+b,0)/n:null;const prefix=(w,p)=>Object.entries(s.responses[w]).filter(([id])=>id.startsWith(p)).map(([,x])=>x.value);return {data_role:'DEMO',not_research_data:true,Y:complete(s.trials.filter(x=>x.status==='complete').map(x=>x.choice_selected),7),RD4:complete(prefix('STATE','RD'),4),MD6:complete(prefix('STATE','MD'),6),ANG3:complete(prefix('STATE','ANG'),3),PRDS:Object.fromEntries(['T0','T1','T2'].map(w=>{const v=prefix(w,'PRDS');const m=complete(v,3);return [w,m===null?null:m*3];})),MD26:null,CC_BPAQ22:null};}
export function act(s,a,c,now=Date.now()){
 requireIt(s.version===VERSION&&!s.withdrawn,'该版本已结束或已撤回');
 requireIt(a&&typeof a.type==='string','缺少操作');
 if(a.type==='pause'){s.events.push({type:'pause',stage:s.stage,at:stamp()});return s;}
 if(a.type==='withdraw'){s.withdrawn=true;next(s,'withdrawn');return s;}
 if(a.type==='exit'){s.exit_from=s.stage;next(s,'exited');return s;}
 if(a.type==='visit'){
  requireIt(s.stage==='dashboard','先完成当前场次或暂停，不可覆盖当前进度');
  requireIt([1,2,3,4,5].includes(a.visit),'无此场次');
  requireIt(!s.visits[a.visit]?.complete,'该场次已提交');
  requireIt(s.arm,'须先完成前测及一次随机');
  const offsets=[0,3,7,10,24];const scheduled=a.visit===5&&s.visits[4]?.course_completed_at?Date.parse(s.visits[4].course_completed_at)+14*86400000:Date.parse(s.baseline_at)+offsets[a.visit-1]*86400000;
  requireIt(now>=scheduled||a.demo_override===true,'尚未到建议日期；测试跳日期必须明确标记');
  if(a.demo_override)s.events.push({type:'demo_date_override',visit:a.visit,actual_at:stamp(),scheduled_at:new Date(scheduled).toISOString()});
  requireIt(a.visit!==1,'首次课程应随前测进行');
  s.visit=a.visit;s.visits[a.visit]={started_at:stamp(),scheduled_at:new Date(scheduled).toISOString(),complete:false};
  if(a.visit===5)s.visits[5].days_since_final_course=s.visits[4]?.course_completed_at?(now-Date.parse(s.visits[4].course_completed_at))/86400000:null;
  if(a.visit===5){s.wave='T2';next(s,'general');}else next(s,'course_intro');
 }else if(s.stage==='eligibility'){
  // Keep the stored stage name for existing paused demos; this page now
  // collects four demographics only, not answers to the old screening form.
  requireIt(a.type==='demographics','请先填写基本资料');
  requireIt(Number.isInteger(a.age)&&a.age>=18&&a.age<=99,'年龄请填写18至99的整数');
  requireIt(Number.isInteger(a.gender)&&a.gender>=0&&a.gender<=3,'请选择性别');
  requireIt(Number.isInteger(a.year)&&a.year>=0&&a.year<=5,'请选择年级');
  requireIt(typeof a.major==='string','请填写专业');
  const major=a.major.normalize('NFKC').trim();
  requireIt(major.length>=1&&major.length<=60&&!/[\u0000-\u001f\u007f]/.test(major),'专业请填写1至60个字，不要换行');
  s.demographics={age:a.age,gender:a.gender,year:a.year,major};s.profile_form='four_demographics_v3';
  // Do not fabricate "adult/student/no prior participation" answers.
  s.visit=1;s.wave='T0';s.visits[1]={started_at:stamp(),complete:false};next(s,'general');
 }else if(s.stage==='general'||s.stage==='state'||s.stage==='post'){
  const wave=s.stage==='general'?s.wave:s.stage==='state'?'STATE':'POST';
  const list=s.stage==='general'?c.generalItems:s.stage==='state'?c.stateItems:c.postItems;
  const item=list[s.index];requireIt(a.type==='answer'&&a.id===item.id,'题目状态已变化');val(a.value,1,item.labels.length);record(s,wave,item.id,a.value);s.index++;
  if(s.index===list.length){if(s.stage==='general')next(s,'unavailable');else next(s,s.stage==='state'?'rules':'debrief');}
 }else if(s.stage==='unavailable'){
  requireIt(a.type==='ack_unavailable','请确认待核题册说明');
  s.unavailable[s.wave]={modules:c.unavailableModules.map(x=>x.id),reason:'item_book_not_verified',acknowledged_at:stamp()};
  if(s.wave==='T0'){requireIt(s.arm===null,'不能重新随机');s.arm=randomInt(2)===0?'A':'B';s.baseline_at=stamp();s.assignment={method:'server_crypto_equal_probability_demo',at:stamp()};next(s,'course_intro');}
  else if(s.wave==='T1')next(s,'scene');else {s.visits[5].complete=true;s.visits[5].ended_at=stamp();next(s,'finished');}
 }else if(s.stage==='course_intro'){
  requireIt(a.type==='continue','未知操作');next(s,'course_case');
 }else if(s.stage==='course_case'){
  const caseItem=c.groups[s.arm][s.visit-1].cases[s.index];
  requireIt(a.id===caseItem.id,'案例状态已变化');
  const guided=caseItem.mode==='guided';
  if(s.step===0){
   requireIt(a.type==='case_choice'&&Object.hasOwn(caseItem.options,a.choice),'请选择案例选项');
   let writes=null;if(!guided)writes=validateWrites(a.writes);
   s.learning.push({id:caseItem.id,visit:s.visit,choice:a.choice,writes,submitted_at:stamp(),first_response_locked:!guided,feedback_at:null});s.step=1;
  }else if(s.step===1){
   requireIt(a.type==='case_feedback','请查看固定反馈');s.learning.at(-1).feedback_at=stamp();s.step=2;
  }else{
   requireIt(a.type==='case_finish','未知案例操作');if(guided)s.learning.at(-1).writes=validateWrites(a.writes);
   s.learning.at(-1).first_response_locked=true;s.learning.at(-1).ended_at=stamp();s.step=0;s.index++;
   if(s.index===3)next(s,'course_end');
  }
 }else if(s.stage==='course_end'){
  requireIt(a.type==='continue','未知操作');s.visits[s.visit].course_completed_at=stamp();
  if(s.visit===4){s.interval={started_ms:now,started_at:stamp(),duration_ms:180000,actions:[]};next(s,'interval');}
  else {s.visits[s.visit].complete=true;s.visits[s.visit].ended_at=stamp();next(s,'dashboard');}
 }else if(s.stage==='interval'){
  if(a.type==='shape'){requireIt(['circle','square'].includes(a.choice),'图形选项无效');s.interval.actions.push({choice:a.choice,at:stamp()});}
  else {requireIt(a.type==='interval_end','未知操作');requireIt(now-s.interval.started_ms>=180000||a.demo_override===true,'共同间隔尚未完成');s.interval.ended_at=stamp();s.interval.demo_shortened=a.demo_override===true&&now-s.interval.started_ms<180000;s.wave='T1';next(s,'general');}
 }else if(s.stage==='scene'){
  requireIt(a.type==='continue','未知操作');s.scene_first_at=stamp();next(s,'facts');
 }else if(s.stage==='facts'||s.stage==='rule_checks'){
  requireIt(a.type==='checks','未知操作');const list=s.stage==='facts'?c.sceneChecks:c.ruleChecks;
  requireIt(Array.isArray(a.answers)&&a.answers.length===3&&a.answers.every((v,i)=>Number.isInteger(v)&&v>=0&&v<list[i].options.length),'理解题不完整');
  const prior=s.checks.filter(x=>x.stage===s.stage);const wrong=a.answers.some((v,i)=>v!==list[i].answer);
  s.checks.push({stage:s.stage,answers:a.answers,wrong,attempt:prior.length+1,at:stamp()});
  if(!wrong||prior.length>=1){if(s.stage==='facts')next(s,'state');else next(s,'practice');}
 }else if(s.stage==='rules'){
  requireIt(a.type==='continue','未知操作');next(s,'rule_checks');
 }else if(s.stage==='practice'){
  requireIt(a.type==='practice_choice','未知操作');val(a.value,0,10);requireIt(a.value!==null,'练习选择未填');s.practice.push({round:s.practice.length+1,choice:a.value,at:stamp()});
  s.practice_target_ms=now;next(s,'practice_target');
 }else if(s.stage==='practice_target'){
  requireIt(a.type==='practice_click'||a.type==='practice_timeout','未知操作');requireIt(a.type==='practice_click'||now-s.practice_target_ms>=3000,'练习超时尚未到');s.practice.at(-1).target_result=a.type;next(s,'practice_feedback');
 }else if(s.stage==='practice_feedback'){
  requireIt(a.type==='continue','未知操作');next(s,s.practice.length===3?'trial_choice':'practice');
 }else if(s.stage==='trial_choice'){
  requireIt(a.type==='trial_choice','未知操作');val(a.value,0,10);requireIt(a.value!==null&&s.trials.length<7,'正式轮次选择无效');
  const round=s.trials.length+1;s.trials.push({round,choice_selected:a.value,opportunity:c.opportunities[round-1],confirmed_at:stamp(),target_ms:now,status:'locked',executed_deduction:null});next(s,'trial_target');
 }else if(s.stage==='trial_target'){
  const t=s.trials.at(-1);requireIt(a.type==='trial_click'||a.type==='trial_timeout','未知操作');requireIt(a.type==='trial_click'||now-t.target_ms>=3000,'等待时间尚未到');
  t.target_result=a.type;t.click_latency_ms=a.type==='trial_click'?Math.max(0,now-t.target_ms):null;t.executed_deduction=t.opportunity?t.choice_selected:0;t.status='complete';t.ended_at=stamp();next(s,'trial_feedback');
 }else if(s.stage==='trial_feedback'){
  requireIt(a.type==='continue','未知操作');next(s,s.trials.length===7?'post':'trial_choice');
 }else if(s.stage==='debrief'){
  requireIt(a.type==='debrief','未知操作');requireIt(['none','slight','marked','strong','skip'].includes(a.discomfort),'不适选项无效');s.discomfort=a.discomfort;
  s.visits[4].complete=true;s.visits[4].ended_at=stamp();next(s,'dashboard');
 }else throw Error('当前状态不能提交该操作');
 s.events.push({type:a.type,visit:s.visit,stage_after:s.stage,at:stamp()});return s;
}
function validateWrites(w){requireIt(Array.isArray(w)&&w.length===2,'需要两句或明确暂答状态');return w.map(x=>{requireIt(x&&['text','cant_think','skip'].includes(x.status),'书写状态无效');const text=typeof x.text==='string'?x.text.trim():'';requireIt(text.length<=200,'每句最多200字');requireIt(x.status!=='text'||text.length>0,'留空时请选择暂时想不到或暂不回答');return {status:x.status,text:x.status==='text'?text:''};});}
