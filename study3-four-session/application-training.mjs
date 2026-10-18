export const isApplicationTraining=c=>c.training_ui?.version==='S3-WRITE-FIRST-PRESENTATION-v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=v=>String(v??'').split('\n').filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join('');
const button=(label,attrs='')=>`<button ${attrs}>${esc(label)}</button>`;
const list=xs=>`<ol>${xs.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
const answer=x=>x?.status==='text'?x.text:x?.status==='cant_think'?'暂时想不到':'暂不回答';
export function applicationTrainingBody(s,c,{entry=null,preview=false}={}){
 if(!isApplicationTraining(c)||s.version!==c.version)throw Error('独立应用材料版本不一致');
 const course=c.groups[s.arm][s.visit-1],heading=`<h2>第${s.visit}次学习 · ${esc(course.title)}</h2>`;
 if(s.stage==='course_orientation')return heading+text(course.context)+`<div class="panel"><h3>接下来怎么做</h3>${text(course.task_guide)}</div><details><summary>作答说明</summary>${text(c.training_ui.first_response)}</details>`+button('看看方法','data-act="continue" class="primary"');
 if(s.stage==='course_intro')return heading+`<h3>可以这样做</h3>${list(course.steps)}<details><summary>需要说明的词</summary>${list(course.terms)}</details>`+button('看看例子','data-act="continue" class="primary"');
 if(s.stage==='course_demo'){const e=course.example;return `<h2>先看一个例子</h2>${text(e.explanation)}<div class="panel">${text(e.input)}</div>${list(e.steps)}<div class="panel"><h3>可以这样回答</h3>${text(e.output)}</div>`+button('开始练习','data-act="continue" class="primary"');}
 if(s.stage==='course_case'){
  const q=course.cases[s.index];
  let html=`<h2>练习 ${s.index+1}/3 · ${esc(q.title)}</h2><p class="muted">${['跟着步骤试一试','减少提示，自己来','换个情境，独立完成'][s.index]}</p><div class="panel">${text(q.story)}</div>`;
  if(s.step===0){
   if(q.hints.length)html+=`<div class="panel"><h3>${s.index===0?'可以参考这些步骤':'小提醒'}</h3>${list(q.hints)}</div>`;
   return html+`<form id="application-case">${text(q.write_help)}${q.prompts.map((p,i)=>`<label>${esc(p)}<textarea name="write${i}" maxlength="200" placeholder="${esc(q.workbench.placeholders[i])}"></textarea><select name="status${i}"><option value="text">自己填写</option><option value="cant_think">暂时想不到</option><option value="skip">暂不回答</option></select></label>`).join('')}<p class="muted">提交后会保留这次回答，再显示讲解和参考。参考写法不需要照抄。</p>${button('提交回答，看看讲解','class="primary"')}</form>`;
  }
  if(s.step===1){
   const row=s.learning.at(-1);if(row?.id!==q.id||!row.first_response_locked)throw Error('没有对应的首次回答');
   return html+`<div class="panel"><h3>${esc(q.workbench.title)}（已保存）</h3>${q.prompts.map((p,i)=>`<p>${esc(p)}</p><p class="own-answer">${esc(answer(row.writes[i]))}</p>`).join('')}</div><h3>一起看看</h3>${text(q.feedback)}<div class="panel"><h3>一种参考写法</h3>${list(q.models)}</div>${text('对照自己的回答，看看哪些地方想到了，哪些还可以补充。表达不必和参考一样；网页不会自动判定你是否学会。')}<form id="application-finish">${button('看完了，继续','class="primary"')}</form>`;
  }
  throw Error('独立应用练习步骤无效');
 }
 if(s.stage==='course_end')return `<h2>本次练习完成了</h2>${text(course.end)}`+button(s.visit===4?(preview?'保存并结束本次练习':entry?'保存第4次练习，转到中测入口':'继续共同环节及中测'):'结束本次并保存','data-act="continue" class="primary"');
 throw Error('未知训练页面');
}
