import * as V4 from './model-v4.mjs';
import * as V5 from './model-v5.mjs';
import * as V6 from './model-v6.mjs';
import * as V7 from './model-v7.mjs';
import * as V8 from './model-v8.mjs';
import * as V9 from './model-v9.mjs';
import {entryById} from './entry.mjs';
const impl=version=>{if(version===V4.VERSION)return V4;if(version===V5.VERSION)return V5;if(version===V6.VERSION)return V6;if(version===V7.VERSION)return V7;if(version===V8.VERSION)return V8;if(version===V9.VERSION)return V9;throw Error('独立试做材料版本无法识别，不迁移旧答');};
export function freshPreview(id,arm,version=V9.VERSION){
 const entry=entryById(id);if(!entry)throw Error('请选择独立试做环节');
 if(!['A','B'].includes(arm))throw Error('服务端分组记录无效');
 const s=impl(version).fresh();s.id='PREVIEW-'+s.id;s.preview_only=true;s.preview_entry=id;
 s.fixture={not_research_data:true,kind:'isolated_ui_entry',no_prerequisite_answers_generated:true,real_training_completed:false,created_at:new Date().toISOString()};
 s.arm=id==='pre'?null:arm;s.preview_bound_arm=arm;
 s.assignment=id==='pre'?null:{method:'internal_technical_fixture_not_participant_assignment',at:new Date().toISOString()};
 if(entry.kind==='practice'){s.visit=entry.visit;s.stage=[V6.VERSION,V7.VERSION,V8.VERSION,V9.VERSION].includes(version)?'course_orientation':'course_intro';s.visits[entry.visit]={kind:'isolated_ui_preview',started_at:new Date().toISOString(),complete:false};}
 else {s.visit=id==='pre'?0:id==='mid'?4:5;s.wave=entry.wave;s.stage='general';s.visits[s.visit]={kind:'isolated_ui_preview',started_at:new Date().toISOString(),complete:false};}
 return s;
}
export function previewAction(s,input,c){
 if(!s.preview_only||input.entry_id!==s.preview_entry)throw Error('这是另一个环节的独立试做，请返回本环节或明确重新开始');
 if(input.content_version!==s.version||input.revision!==s.revision)throw Error('独立试做已在另一窗口更新，请刷新；没有覆盖答案');
 if(['visit','withdraw'].includes(input.action?.type))throw Error('独立试做不能转成跨次记录或修改身份库');
 const result=impl(s.version).act(structuredClone(s),input.action,c);if(s.preview_entry==='pre'&&s.arm===null&&result.arm){result.arm=s.preview_bound_arm;result.assignment=s.preview_assignment??{method:'internal_technical_fixture_not_participant_assignment'};}result.revision++;return result;
}
export function previewView(s){return {state:s,scores:impl(s.version).score(s),content_version:s.version,export_role:'TECHNICAL_PREVIEW',not_research_data:true,contains_student_id:false};}
