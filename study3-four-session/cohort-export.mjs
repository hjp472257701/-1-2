// New longitudinal stores only. Never migrates or queries technical/Study 1/2 data.
import {CONTENT_V9 as C} from './server.mjs';
import {score} from './model-v9.mjs';
import {ENTRIES} from './entry.mjs';
const cell=v=>'"'+(v==null?'':String(typeof v==='object'?JSON.stringify(v):v)).replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
const csv=rows=>'\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
export function entryStatus(s,id){
 if(id==='pre')return s.baseline_at?'completed':s.entry_started.pre?'in_progress':'not_started';
 if(id==='mid')return s.visits[4]?.complete?'completed':s.entry_started.mid?'in_progress':'not_started';
 if(id==='post')return s.visits[5]?.complete?'completed':s.entry_started.post?'in_progress':'not_started';
 const n=Number(id.at(-1));return s.visits[n]?.course_completed_at?'completed':s.entry_started[id]?'in_progress':'not_started';
}
export function cohortSnapshot(store){
 const states=store.all(),role=store.role;
 const manifest={schema:'S3-LONGITUDINAL-EXPORT-v1',study:3,data_role:role,environment:role.toLowerCase(),participants:states.length,entry_records:states.reduce((n,s)=>n+Object.keys(s.entry_started).length,0),not_research_data:false,eligible_for_formal_analysis:role==='FORMAL',collection_enabled:store.enabled,exported_at:new Date().toISOString(),contains_student_id:false,protocol:store.protocol,missing_policy:'未答保持空值；未进入环节只列状态，不补造答卷',files:['overview.csv','responses-long.csv','responses-wide.csv','training.csv','trials.csv','events.csv','items.csv','complete-records.json','README.txt']};
 manifest.followup_policy=store.followupPolicy;manifest.followup_amendment=store.followupAmendment;
 const overview=[['research_id','data_role','group','entry','wave','status','answered','skipped','started_at','ended_at','protocol_version','followup_policy_version','followup_days','post_available_at','actual_post_days_since_final_course']];
 const long=[['research_id','data_role','group','entry','wave','item_id','value','missing_reason','submitted_at','presentation_version']];
 const columns=['T0','T1','T2'].flatMap(w=>C.generalItems.map(q=>w+'__'+q.id)).concat(C.stateItems.map(q=>'STATE__'+q.id),C.postItems.map(q=>'POST__'+q.id));
 const wide=[['research_id','data_role','group',...ENTRIES.map(e=>e.id+'__status'),...columns,...columns.map(k=>k+'__missing_reason')]];
 const training=[['research_id','data_role','group','entry','visit','course_record_json']];
 const trials=[['research_id','data_role','group','entry','kind','round','choice_selected','executed_deduction','record_json']];
 const events=[['research_id','data_role','group','kind','record_json']];
 const items=[['material_version','measurement_version','module','item_id','item_json']];
 for(const module of ['generalItems','stateItems','postItems','course_experience'])for(const q of C[module])items.push([C.version,C.measurement_version,module,q.id,q]);
 const views=[];
 for(const s of states){
  const base=[s.id,role,s.arm],scored={...score(s),data_role:role,not_research_data:false};
  const followup=store.policy(s),postDue=store.due(s,5),postAvailable=Number.isFinite(postDue)?new Date(postDue).toISOString():null;
  const answerMap=new Map();for(const [w,rows] of Object.entries(s.responses))for(const [id,a] of Object.entries(rows)){answerMap.set(w+'__'+id,a);long.push([...base,w==='T0'?'pre':w==='T2'?'post':'mid',w,id,a.value,a.missing_reason,a.submitted_at,a.presentation_version]);}
  for(const e of ENTRIES){const wave=e.id==='pre'?'T0':e.id==='mid'?'T1':e.id==='post'?'T2':null;const answers=wave?Object.values(s.responses[wave]):[];overview.push([...base,e.id,wave,entryStatus(s,e.id),answers.filter(a=>a.value!==null).length,answers.filter(a=>a.value===null).length,s.entry_started[e.id],e.id==='pre'?s.baseline_at:e.id==='mid'?s.visits[4]?.ended_at:e.id==='post'?s.visits[5]?.ended_at:s.visits[e.visit]?.course_completed_at,store.protocol.version]);}
  for(const row of overview.slice(-ENTRIES.length))row.push(followup.version,followup.followup_days,postAvailable,s.visits[5]?.days_since_final_course??null);
  wide.push([...base,...ENTRIES.map(e=>entryStatus(s,e.id)),...columns.map(k=>answerMap.get(k)?.value??null),...columns.map(k=>answerMap.has(k)?answerMap.get(k).missing_reason:'not_answered')]);
  for(const l of s.learning)training.push([...base,'practice-'+l.visit,l.visit,l]);
  for(const kind of ['practice','trials'])for(const t of s[kind])trials.push([...base,'mid',kind,t.round,t.choice_selected??t.choice,t.executed_deduction,t]);
  for(const kind of ['events','checks','visits'])for(const e of Object.values(s[kind]))events.push([...base,kind,e]);
  views.push({state:s,scores:scored,environment:role,source_material_version:C.version,followup_policy:followup,post_available_at:postAvailable});
 }
 const files={'overview.csv':csv(overview),'responses-long.csv':csv(long),'responses-wide.csv':csv(wide),'training.csv':csv(training),'trials.csv':csv(trials),'events.csv':csv(events),'items.csv':csv(items),'complete-records.json':JSON.stringify({manifest,records:views},null,2),'README.txt':`研究三${role}独立纵向导出。一个research_id对应一个参与号码的完整进度。\n环境为${role}，预测试不自动纳入正式分析。代码不包含原学号或进入码。\n原课程/测量版本标识可能保留DEMO字符串，这是材料来源版本，不是本次数据身份；身份以manifest.data_role及state.data_role为准。\n零值是实际作答，空值及跳答原因保留。training包含首答、应用、修订与体验；trials区分练习与实际轮次。\n参加说明及同意时间保存在state.consent；实际间隔及首次/末次时间保留。\n`};
 files['README.txt']+='\n当前后测时间规则：'+store.followupPolicy.followup_days+'天（从实际第四次训练结束计算）；规则版本：'+store.followupPolicy.version+'。\nstate.protocol与manifest.protocol保留入组时冻结的原协议；后测时间修订以followup_policy/followup_amendment及overview新增列为准。已开始后测的记录保留当时规则，不追写旧答案或日期。\n预测试24小时随访用于流程检查，不能作为14天维持效果。\n';
 return {manifest,overview:overview.slice(1).map(r=>Object.fromEntries(overview[0].map((k,i)=>[k,r[i]]))),files};
}
