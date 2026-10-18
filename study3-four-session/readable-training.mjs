import {workbenchResult} from './workbench.mjs';

// Only the new material version uses this presentation. Old records retain
// their original course wording and rendering path in app.mjs.
export const isReadableTraining=c=>c.training_ui?.version==='S3-READABLE-PRESENTATION-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=v=>String(v??'').split('\n').filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join('');
const button=(label,attrs='')=>`<button ${attrs}>${esc(label)}</button>`;
const ordered=items=>`<ol>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
const terms=c=>`<details><summary>需要说明的词</summary><ul>${c.terms.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`;

function writes(c,arm,showModels=false){
 const fields=c.prompts.map((prompt,i)=>`<label>${esc(prompt)}${showModels?text('一种参考写法：'+c.models[i]):''}<textarea name="write${i}" maxlength="200" placeholder="${esc(c.workbench.placeholders[i])}"></textarea><select name="status${i}"><option value="text">自己填写</option><option value="cant_think">暂时想不到</option><option value="skip">暂不回答</option></select></label>`).join('');
 const empty=[{status:'text',text:''},{status:'text',text:''}];
 return `<h3>${arm==='A'?'写写你的想法':'动手整理'}</h3>${text(c.write_help)}${fields}<div class="workbench" aria-live="polite"><h3>${esc(c.workbench.title)}</h3><div id="workbench-result">${workbenchResult(c.workbench.kind,empty).map(([label,value])=>`<div class="artifact-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div></div>`;
}

export function readableTrainingBody(s,c,{entry=null,preview=false}={}){
 if(!isReadableTraining(c))throw Error('此呈现仅用于新版训练材料');
 const course=c.groups[s.arm][s.visit-1];
 const heading=`<h2>第${s.visit}次学习 · ${esc(course.title)}</h2>`;
 const materialTitle=s.arm==='A'?'事情经过':'这份资料';
 if(s.stage==='course_orientation')return `${heading}${text(course.context)}<div class="panel"><h3>接下来怎么做</h3>${text(course.task_guide)}</div><details><summary>作答说明</summary>${text(c.training_ui.learning)}${text(c.training_ui.first_response)}</details>${button('看看方法','data-act="continue" class="primary"')}`;
 if(s.stage==='course_intro')return `${heading}<h3>可以这样做</h3>${ordered(course.steps)}${terms(course)}${button('看看例子','data-act="continue" class="primary"')}`;
 if(s.stage==='course_demo'){
  const e=course.example;
  return `<h2>先看一个例子</h2>${text(e.explanation)}<div class="panel"><h3>${materialTitle}</h3>${text(e.input)}</div>${ordered(e.steps)}<div class="panel"><h3>可以这样回答</h3>${text(e.output)}</div>${button('开始练习','data-act="continue" class="primary"')}`;
 }
 if(s.stage==='course_case'){
  const q=course.cases[s.index],guided=q.mode==='guided',row=s.learning.at(-1);
  let body=`<h2>练习 ${s.index+1}/3 · ${esc(q.title)}</h2><div class="panel">${text(q.story)}</div>`;
  if(s.step===0)return body+`<form id="case"><h3>${esc(q.question)}</h3><div class="choices">${Object.entries(q.options).map(([key,value])=>`<label><input name="choice" type="radio" value="${key}" required>${esc(key+'．'+value)}</label>`).join('')}</div>${guided?'':writes(q,s.arm)}${button(guided?'看看讲解':'提交回答','class="primary"')}</form>`;
  if(s.step===1)return body+`<div class="panel"><h3>看看这个选择</h3>${text(q.feedback_by_choice[row.choice])}</div>${button('继续','data-case-feedback="1" class="primary"')}`;
  if(s.step===2)return body+`<form id="casefinish">${guided?writes(q,s.arm,true):`<h3>一种参考写法</h3>${ordered(q.models)}`}${button('保存并继续','class="primary"')}</form>`;
  throw Error('未知练习步骤');
 }
 if(s.stage==='course_end')return `<h2>本次练习完成了</h2>${text(course.end)}${button(s.visit===4?(preview?'保存并结束本次练习':entry?'保存第4次练习，转到中测入口':'继续共同环节及中测'):'结束本次并保存','data-act="continue" class="primary"')}`;
 throw Error('未知训练页面');
}
