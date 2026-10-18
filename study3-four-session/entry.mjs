// Entry links select a view, never a new group, answer set, or progress state.
export const BASE='/study3-four-session/';
export const ENTRIES=[
 {id:'pre',path:BASE+'measurement/pre/',label:'前测',kind:'measurement',wave:'T0'},
 ...[1,2,3,4].map(visit=>({id:'practice-'+visit,path:BASE+'practice-'+visit+'/',label:'第'+visit+'次练习',kind:'practice',visit})),
 {id:'mid',path:BASE+'measurement/mid/',label:'中测 · 四次练习结束',kind:'measurement',wave:'T1'},
 {id:'post',path:BASE+'measurement/post/',label:'后测 · 结束两周后',kind:'measurement',wave:'T2',visit:5}
];
export function entryById(id){if(id==null||id==='')return null;const e=ENTRIES.find(x=>x.id===id);if(!e)throw Error('无法识别入口，请使用活动首页提供的链接');return e;}
export const entryByPath=path=>ENTRIES.find(x=>x.path===path)??null;
export const previewPath=e=>BASE+'try/'+e.id+'/';
export const previewByPath=path=>ENTRIES.find(x=>previewPath(x)===path)??null;
const supported=s=>['S3-MD-4SESSION-DEMO-v0.2','S3-MD-4SESSION-DEMO-v0.3','S3-MD-4SESSION-DEMO-v0.4','S3-MD-4SESSION-DEMO-v0.5','S3-MD-4SESSION-DEMO-v0.6','S3-MD-4SESSION-DEMO-v0.7','S3-MD-4SESSION-DEMO-v0.8','S3-MD-4SESSION-DEMO-v0.9'].includes(s.version);
export function currentEntry(s){
 if(s.stage==='eligibility'||s.stage==='unavailable'||(s.stage==='general'&&s.wave==='T0'))return entryById('pre');
 if(s.stage.startsWith('course_'))return entryById('practice-'+s.visit);
 if((s.stage==='general'&&s.wave==='T2')||s.stage==='finished')return entryById('post');
 if(s.visit===4&&!['dashboard','exited','withdrawn'].includes(s.stage))return entryById('mid');
 return null;
}
export function entryView(s,e){
 if(!e)return {mode:'active'};
 if(!supported(s))return {mode:'legacy',message:'这是旧版演示记录，请回活动总入口继续原版；不会换题或改进度。'};
 if(s.withdrawn||['withdrawn','exited'].includes(s.stage))return {mode:'stopped',message:'这条记录已停止，分场次链接不会重开或补全它。'};
 const ended=e.id==='pre'?Boolean(s.baseline_at):e.id==='mid'?Boolean(s.visits[4]?.complete):e.id==='post'?Boolean(s.visits[5]?.complete):Boolean(s.visits[e.visit]?.course_completed_at);
 if(ended)return {mode:'complete',message:e.label+'已保存，不会重复作答。'};
 if(currentEntry(s)?.id===e.id)return {mode:'active'};
 if(e.kind==='practice'&&['waiting_first_course','dashboard'].includes(s.stage)&&s.arm)return {mode:'start',visit:e.visit};
 if(e.id==='post'&&s.stage==='dashboard'&&s.visits[4]?.course_completed_at)return {mode:'start',visit:5};
 const current=currentEntry(s);
 return {mode:'blocked',current:current?.id??null,message:e.id==='pre'?'已有前测记录，请从原进度继续。':e.id==='mid'?'先完成第四次练习，才能进入中测；此链接不会跳过练习。':e.id==='post'?'先完成第四次练习及中测，后测按实际末课结束后14天安排。':'请先完成前测或保存中的当前环节，再进入本次练习。'};
}
export function assertEntryAction(s,e,a){
 if(!e)return;
 const view=entryView(s,e);
 if(['pause','exit','withdraw'].includes(a?.type))return;
 if(view.mode==='active'&&a?.type!=='visit')return;
 if(view.mode==='start'&&a?.type==='visit'&&a.visit===view.visit)return;
 throw Error('当前链接与记录进度不对应；请按页面提示进入正确环节，原进度没有改动');
}
