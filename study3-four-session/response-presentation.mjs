// Project-authored complete Chinese category labels, not a published translation.
export const PRESENTATION_VERSION='S3-RESPONSE-LABELS-CN-v1';
export const CATEGORY_LABELS={
 PRDS3:['完全不同意','不同意','比较不同意','比较同意','同意','完全同意'],
 MD8:['非常不同意','不同意','比较不同意','中立（既不赞同也不反对）','比较同意','同意','非常同意'],
 AQR12:['完全不符合','比较不符合','介于符合与不符合之间','比较符合','完全符合']
};
export function responseLabels(item){
 if(/^PRDS[1-3]$/.test(item.id)&&item.labels.length===6)return [...CATEGORY_LABELS.PRDS3];
 const key=Object.keys(CATEGORY_LABELS).find(k=>item.id?.startsWith(k+'_'));
 if(key&&item.labels.length===CATEGORY_LABELS[key].length)return [...CATEGORY_LABELS[key]];
 // Already-worded state, anger and experience categories retain their labels.
 return [...item.labels];
}
export function annotatePresentation(before,next,action,content){
 if(action?.type!=='answer'||action.presentation_version!==PRESENTATION_VERSION)return next;
 const wave=before.stage==='general'?before.wave:before.stage==='state'?'STATE':before.stage==='post'?'POST':null;
 const list=before.stage==='general'?content.generalItems:before.stage==='state'?content.stateItems:before.stage==='post'?content.postItems:null;
 const item=list?.find(q=>q.id===action.id),answer=wave?next.responses[wave]?.[action.id]:null;
 if(item&&answer){answer.presentation_version=PRESENTATION_VERSION;answer.presented_labels=responseLabels(item);}
 return next;
}
