import {REVIEWED_COPY} from './reviewed-courses.mjs';
export const isSourceTraining=c=>c.training_ui?.version==='S3-SOURCE-ADAPTED-PRESENTATION-v1';
export const SOURCE_COPY_VERSION='S3-SOURCE-COPY-CN-v47-20261017';
// Display-only wording revision. Keep the source course and saved answers intact.
const readablePrompt=p=>p==='请改写小安的判断，保留已经知道的信息，也保留还不清楚的部分。'
 ?'如果你是小安，这句话可以怎么说？请用自己的话写一写。已经知道的事直接说，还不清楚的地方就说明自己不确定。':p;
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=v=>String(v??'').split('\n\n').filter(Boolean).map(x=>x.split('\n').every(line=>line.startsWith('- '))?`<ul>${x.split('\n').map(line=>`<li>${esc(line.slice(2))}</li>`).join('')}</ul>`:`<p>${esc(x)}</p>`).join('');
const button=(label,attrs='')=>`<button ${attrs}>${esc(label)}</button>`;
const cont=label=>button(label,'data-act="continue" class="primary"');
const answer=x=>x?.status==='text'?x.text:x?.status==='cant_think'?'暂时想不到':'暂不回答';
const own=(prompts,writes)=>`<div class="panel"><h3>你已经保存的回答</h3>${prompts.map((p,i)=>`<p>${esc(p)}</p><p class="own-answer">${esc(answer(writes[i]))}</p>`).join('')}</div>`;
function fields(prompts,optional=false){return prompts.map((p,i)=>`<label>${esc(p)}<textarea name="write${i}" maxlength="400" placeholder="用自己的话写即可，不要求与示例一致"></textarea><select name="status${i}" aria-label="第${i+1}项作答方式"><option value="${optional?'skip':'text'}">${optional?'暂不回答':'自己填写'}</option>${optional?'<option value="text">自己填写</option>':''}<option value="cant_think">暂时想不到</option>${optional?'':'<option value="skip">暂不回答</option>'}</select></label>`).join('');}
const form=(kind,prompts,label,extra='',optional=false)=>`<form id="source-form" data-kind="${kind}" data-count="${prompts.length}">${extra}${fields(prompts,optional)}${button(label,'class="primary"')}</form>`;
export function sourceTrainingBody(s,c,{entry=null,preview=false}={}){
 if(!isSourceTraining(c)||s.version!==c.version)throw Error('改编课程版本不一致');
 const base=c.groups[s.arm][s.visit-1],reviewed=REVIEWED_COPY.courses[s.arm+s.visit],common=REVIEWED_COPY.common;
 const g=reviewed?{...base,...reviewed}:base,row=s.learning.find(x=>x.visit===s.visit);
 const story=s.arm==='A'&&s.visit===1
  ?[
   '别人做错了事，导致你生气，这是人之常情。但对方做错事和你如何回应，是两码事。即使是对方先做错，我们也需要想一想：自己接下来的回应是否合适？下面我们看一个小组作业的例子。',
   '小组作业周五要提交给学院。大家提前分好了工，小周负责收集资料，其他成员要等资料齐了，才能继续后面的工作。可是，约定的时间已经过去了两天，小周还是没有完成，其他人只好先做手头能做的部分。到了周四晚上，小林催了好几次，得到的回复仍然是“快好了”。他越想越生气，觉得小周耽误了大家的进度，也没把其他人的时间当回事。',
   '离向学院提交作业只剩几个小时，小周才交来了资料，里面还有多处错误。小林一边修改，一边把催交的聊天记录截图发到了班级群里，并写道：“以后谁组队缺个大爷，可以找他。”群里有人跟着起哄，小林接着又嘲讽了几句。小周私下联系小林，说会把资料里的错误改好，希望他先撤下截图。小林却回道：“现在知道丢人了？你不拖大家后腿，我会这样吗？”',
   '另一位组员劝小林：“小周这次确实耽误了大家，你让他把没做好的部分补上，或者跟老师说，都没问题。可你把截图发到班级群里，还带头挖苦他，这就是在当众羞辱他了。”小林一听，觉得对方是在帮小周说话：“明明是他先不负责，怎么反倒怪起我来了？”'
  ].join('\n\n'):s.arm==='A'&&s.visit===2?[
   '有时候，我们跟别人开了个玩笑，对方没说什么，我们就觉得：“他应该没当回事。”可他是真的不介意，还是只是不说呢？今天，我们就从一个社团排练的故事说起。',
   '一次社团排练时，小雅念错了一句台词，当时就改正了。排练结束后，小齐把小雅念错的那一小段视频剪了出来，还加上嘲笑她的字幕，发到了社团群里。有人转发了视频，也有人说：“排练的时候念错一句话很正常。”小齐却觉得没什么：“就是逗大家笑一笑，又没让她损失什么，能有什么影响？”',
   '小雅看到视频后，在群里发了个笑脸，没说别的。到了第二天，还有人拿她念错的那句台词跟她开玩笑。小雅还是照常来排练，也完成了自己的部分。小齐看她这样，就更觉得没什么了：“你看，她自己都笑了，也没耽误排练，不就是个玩笑嘛。”',
   '后来，一位同学问小齐：“你问过小雅吗？她愿不愿意让大家继续转发这个视频？”小齐说：“她要是真介意，怎么不直接说呢？”至于小雅心里到底怎么想，她还没有说过。'
  ].join('\n\n'):g.story;
 const initialPrompts=s.arm==='A'&&s.visit===1?[
  '小周迟交资料，交来的资料还有错误；小林把聊天记录发到班级群里，并嘲讽了小周。\n\n小周需要为哪些做法负责？小林呢？请分别说说理由。',
  '小林说：“你不拖大家后腿，我会这样吗？”他觉得，小周先做错了，就该被这样对待。你认同小林的这个想法吗？为什么？'
 ]:s.arm==='A'&&s.visit===2?[
  '故事里，哪些是小雅实际做过、说过的，哪些只是小齐自己的猜测？请分别说一说。',
  '小齐看到小雅发了笑脸，后来又照常来排练，就觉得这个视频没给她带来什么影响。你认同他的这个看法吗？为什么？'
 ]:g.initial;
 const teaching=s.arm==='A'&&s.visit===1?[
  '第一种想法：“小周先耽误了大家，所以小林后来怎么对他，都该怪小周。”',
  '第二种想法：“小周迟交资料、资料出错，需要为这些事负责；小林在群里嘲讽他，也要为自己的做法负责。”',
  '小周迟交资料，交来的资料还有错误，耽误了大家的进度。小林为此生气，可以理解。但把截图发到群里、带头嘲讽小周，是小林自己决定的。小周要为没按时做好资料负责，小林也要为自己在群里说的话、做的事负责。',
  '以后再遇到这种事，要是你觉得“是他先做错的，我这么对他也是他自找的”，就问问自己：他做错了什么？我这么对他，合不合适？'
 ].join('\n\n'):s.arm==='A'&&s.visit===2?[
  '第一种想法：“小雅没反对，说明她愿意让大家继续转发。”',
  '第二种想法：“小雅发了个笑脸，后来也照常来排练了。但她愿不愿意让大家继续转发，我们还不知道。”',
  '小雅虽然发了笑脸，也照常来排练，但我们还是不知道她心里怎么想。她没有反对，不能就当作她愿意让大家继续转发。当然，这也不代表她一定很难过。她究竟介不介意，还要听她自己怎么说。'
 ].join('\n\n'):g.teaching;
 const changeInfo=s.arm==='A'&&s.visit===1?'再补充一点：小周后来承认，他没有遇到什么特殊情况，就是自己一直拖着没做。':s.arm==='A'&&s.visit===2?'后来，小雅明确告诉小齐：“我不喜欢大家转发这个视频。请你把它删掉，也别再转发了。”':g.change_prompt;
 const changeQuestion=s.arm==='A'&&s.visit===1?'知道这一点后，你对小周迟交资料这件事的看法会变吗？对小林在群里嘲讽他的看法呢？请分别说说理由。':s.arm==='A'&&s.visit===2?'小雅说完这番话后，你觉得她愿不愿意让大家继续转发视频？为什么？\n\n她的这番话，能不能说明这件事对她影响有多大？请说说你的看法。':reviewed?g.change_question:'这条信息会怎样影响你的判断？请结合上面的问题说明。';
 const changeFeedback=s.arm==='A'&&s.visit===1?'知道小周是自己拖着没做，你可能会更难接受他的拖延。但这不等于小林在群里嘲讽他就没问题了。小周要为耽误进度负责，小林也要为自己在群里说的话、做的事负责。':s.arm==='A'&&s.visit===2?'小雅已经明确表示，她不喜欢大家转发这个视频，希望把它删掉。所以，即使她之前发过笑脸，我们也不能说她不介意。不过，这件事对她影响有多大、会持续影响多久，我们还不确定。':g.change_feedback;
 const reflection=s.arm==='A'&&s.visit===1
  ?'回想一下，生活中有没有发生过类似的事：别人先做了让你生气的事，你当时觉得，自己那样对他也是他自找的。如果有，想想当时对方做了什么，你又是怎么回应的。\n\n在心里想想就好，不用写下来。没有类似的经历，也可以直接继续。'
  :s.arm==='A'&&s.visit===2?'想一想，你有没有遇到过这样的情况：对方没有明确表达自己的态度，你就觉得“他应该不介意”。如果有，回想一下当时的情形：对方有什么反应？你为什么会觉得他不介意？\n\n在心里想想就好，不用写下来。没有类似的经历，也可以直接继续。':reviewed?g.reflection:[g.reflection,'在心里想一想就好，不用写下来。没有合适的例子，也可以直接继续。'].join('\n\n');
 const applicationStory=s.arm==='A'&&s.visit===1?'小程借用室友的耳机时，把耳机弄坏了。他答应赔偿，但室友催了几次，他始终没有兑现。室友越想越生气，决定把两人之前的一段私人聊天记录发到宿舍群里，让小程难堪。这段聊天说的是小程的私事，和耳机损坏没有关系。室友心想：“我已经给过他机会了，是他自己一直拖着不处理，闹成这样也是他自找的。”':s.arm==='A'&&s.visit===2?'小安发现小赵的作业有错，就在小组群里指出来，还用了难听的称呼叫他。小赵当天就改好了作业，但没回应小安说的那些话。小安觉得：“他都把作业改好了，看来我那么说他，也没什么影响。”':g.application_story;
 const applicationPrompts=s.arm==='A'&&s.visit===1?[
  '小程弄坏耳机，又一直拖着没赔偿；室友打算公开小程的私人聊天记录。\n\n小程需要为哪些做法负责？室友呢？请分别说说理由。',
  '室友原本觉得：“小程一直拖着不赔偿，事情才会闹成这样。都是他的责任，跟我没关系。”\n\n假如你是这位室友，现在把两个人的责任分开考虑，你会怎样重新说这句话？请用自己的话写一两句，说清楚：小程需要为哪些事负责，你自己又需要为哪些事负责。'
 ]:s.arm==='A'&&s.visit===2?[
  '小赵把作业改好了，这说明了什么？\n\n能不能因此就认为，他没把小安那个难听的称呼放在心上？请分别说说你的理由。',
  '小安原本觉得：“他都把作业改好了，看来我那么说他，也没什么影响。”\n\n请你替小安重新想一想：作业改好了，说明了什么？小赵介不介意那个称呼，小安知道吗？\n\n想好后，用小安的口吻重新说一两句话。'
 ]:g.application.map(readablePrompt);
 const applicationFeedback=s.arm==='A'&&s.visit===1?'可以参考这样的想法：“小程弄坏了我的耳机，还一直拖着不赔偿，这些事该他负责。但要不要把他的私人聊天记录发到群里，是我自己决定的。要是发出去了，我也得为这件事负责。”':s.arm==='A'&&s.visit===2?[
  '小赵把作业改好了，说明他处理了自己的错误。但他介不介意那个称呼，故事里没有交代，我们也不知道他心里怎么想。所以，不能说他完全没当回事，也不能说他一定很难过。',
  '可以参考这样的想法：“小赵把作业改好了，但这不代表他不介意我那么叫他。他没说自己怎么想，我还不能认定这件事对他没影响。”'
 ].join('\n\n'):g.feedback;
 const revisionIntro=s.arm==='A'&&s.visit===1?'上面的想法只是一个参考，不用照着写。再看看你刚才的回答，有没有把两个人的责任混在一起？你可以补充或修改，也可以保留原来的回答。原来的回答会保存下来，不会被新回答覆盖。':s.arm==='A'&&s.visit===2?'看完参考，再看看你刚才写的回答：有没有什么是故事里没说、你自己猜的？\n\n你可以改一改，也可以保留原来的答案，不一定照着参考写。':reviewed?g.revision_intro:'你可以补充或修改，也可以保留原答。系统会分别保存，不会用新答案覆盖第一次的回答。';
 const revisionInput=s.arm==='A'&&s.visit===1?'如果你选择修改，请在这里写下新的回答；如果保留原答，可以说明理由，也可以不填。':reviewed?common.revision_input:'若要修订，请写下新回答；若保留原答，可以说明原因，也可以不填。';
 const cardPrompt=s.arm==='A'&&s.visit===1?'请用自己的话，把这句话补完整：“当我觉得‘是他先做错的’时，我也要想一想：______。”':s.arm==='A'&&s.visit===2?'请用自己的话，把这句话补完整：“以后我觉得‘没什么影响’时，我会先想一想：______。”':g.card;
 const homework=s.arm==='A'&&s.visit===1?'接下来的几天，遇到类似的事时，你可以试着用一用今天学到的方法。如果你觉得“是他先做错的，我这么对他也是他自找的”，就停下来想一想：对方做错了什么？自己这样回应，又合不合适？如果没有遇到类似的事，也可以用今天耳机的例子再练一次。':s.arm==='A'&&s.visit===2?'接下来这几天，如果你遇到类似的事，觉得对方没说什么，应该就是不介意，可以回想一下：对方到底说了什么、做了什么？自己又脑补了什么？光凭这些反应，能确定他不介意吗？\n\n没遇到类似的情况，也可以用今天小安和小赵的故事再练一次。在心里想想就好，不用为了练习去追问别人的私事。':g.homework;
 const homeworkNotice=s.arm==='A'&&s.visit===1?'课后练习不用写下来，也不用上传任何记录。下次学习时，我们会问你有没有试过今天的方法。按实际情况选择就好，没有练习也没关系。':s.arm==='A'&&s.visit===2?'下次学习时，我们会问你有没有试过今天的方法。按实际情况选择就好，没有练习也没关系。':reviewed?(s.visit<4?common.homework_notice:''):'没有合适的日常情境，可以用课程案例练习；没有练习也请如实记录。不需要上传真实事件或私人文件。';
 const steps={course_source:1,course_initial:2,course_teaching:3,course_change:4,course_reflection:5,course_application:6,course_revision:7,course_card:8};
 const header=`<h2>第${s.visit}次学习 · ${esc(g.title)}</h2>${steps[s.stage]?`<p class="muted">学习环节 ${steps[s.stage]}/8</p>`:''}`;
 let body='';
 if(s.stage==='course_orientation')body=(reviewed?text(common.orientation):text('这次不急着找标准答案。先读一件事，写下自己的看法，再对照讲解，换一个情境试着应用。最后留下自己的学习卡。')+text('每次提交后都会保存。你可以暂停，也可以选择暂时想不到或暂不回答，不需要为了凑字数写长篇。'))+cont(s.visit>1?'先回顾上次练习':'开始本次学习');
 else if(s.stage==='course_review'){
  const previousAvailable=!preview&&Boolean(s.visits[s.visit-1]?.course_completed_at);
  body='<h3>上次的方法，有没有试着用一用？</h3>'+text(reviewed?common.review:'先回顾上次的练习，再开始今天的内容。没有练习也可以如实选择，不影响继续。这里不用写事情经过或任何人的姓名。')+((reviewed?preview&&!previousAvailable:!previousAvailable)?text(reviewed?common.review_missing:'系统没有载入你的上次练习记录。你可以按实际情况回顾，也可以直接跳过；系统不会替你补写上一次的学习记录。'):'');
  body+=form('course_review',[reviewed?(s.arm==='A'?common.review_a:common.review_b):s.arm==='A'?'上次的方法中，哪一步你已经能用，或者还有哪一点拿不准？请只说判断方法，不写真实私事。':'上次的方法中，哪一步你已经能用，或者还有哪一点拿不准？请只说整理方法，不写个人文件的实际名称或路径。'],'保存回顾，开始本次学习',`<fieldset><legend>实际练习情况</legend>${[['real','我在日常情境中试过。'],['simulated','我用课程里的模拟案例练过。'],['none','我没有练习。'],['unsure','我记不清了。'],['skip','我暂不回答。']].map(([v,label])=>`<label><input type="radio" name="practice_status" value="${v}" required>${label}</label>`).join('')}</fieldset>`,true);
 }else if(s.stage==='course_source')body=text(story)+cont('读完了，写下自己的看法');
 else if(s.stage==='course_initial')body=text(reviewed?common.initial:'先读下面的问题，写下你自己的看法。保存后会看到示例和讲解。表达不用和示例一样，你也可以保留自己的判断。')+form('course_initial',initialPrompts,'保存回答，看讲解');
 else if(s.stage==='course_teaching')body='<h3>看看两种思路</h3>'+text(reviewed?common.teaching:'下面是教学示例，不是真实同学的回答，也不是系统对你答案的自动评价。对照自己的回答，看看哪些判断你愿意保留，哪些还想再想一想。')+own(initialPrompts,row.initial.writes)+text(teaching)+cont('看完了，再看看条件变化');
 else if(s.stage==='course_change')body=text(changeInfo)+(s.step===0?form('course_change',[changeQuestion],'保存判断，看讲解'):own([changeQuestion],row.change.writes)+'<h3>一起看看</h3>'+text(changeFeedback)+cont('继续')); 
 else if(s.stage==='course_reflection')body='<h3>私下想一想</h3>'+text(reflection)+cont('继续，试着用在新情境里');
 else if(s.stage==='course_application')body=text(reviewed?(s.arm==='A'?common.application_a:common.application_b):s.arm==='A'?'现在换一件事，请你试着用刚才学的方法判断。先写自己的回答，提交后再看讲解。':'现在换一组资料，请你试着用刚才学的方法整理。先写自己的回答，提交后再看讲解。')+`<div class="panel">${text(applicationStory)}</div>`+form('course_application',applicationPrompts,'保存回答，继续');
 else if(s.stage==='course_revision')body=own(applicationPrompts,row.application.writes)+'<h3>对照讲解，再想一想</h3>'+text(applicationFeedback)+text(revisionIntro)+form('course_revision',[revisionInput],'保存选择，继续',`<fieldset><legend>你想怎样处理刚才的回答？</legend><label><input type="radio" name="mode" value="keep" required>保留原答</label><label><input type="radio" name="mode" value="revise" required>另写一份修订</label></fieldset>`,true);
 else if(s.stage==='course_card')body='<h3>留一张自己的学习卡</h3>'+form('course_card',[cardPrompt],'保存学习卡，填写体验');
 else if(s.stage==='course_experience'){
  const q=c.course_experience[s.index];body=`<h3>本次学习体验（${s.index+1}/5）</h3>`+text(q.text)+`<div class="likert-options">${q.labels.map((x,i)=>button(`${i+1} · ${x}`,`class="likert-choice" data-course-experience="${i+1}"`)).join('')}</div>`+button('暂不回答','data-course-experience="skip"');
 }else if(s.stage==='course_comment')body=form('course_comment',[reviewed?common.comment:'哪一处不清楚、重复或难继续？可不填。'],'保存，查看课后应用', '',true);
 else if(s.stage==='course_end')body='<h3>本次学习已完成</h3>'+own([cardPrompt],row.card.writes)+'<h3>接下来试着用一用</h3>'+text(homework)+text(homeworkNotice)+cont(s.visit===4?(preview?'保存并结束本次练习':entry?'保存第4次练习，转到中测入口':'继续共同环节及中测'):'结束本次并保存');
 else throw Error('未知改编课程页面');
 let reviews='';
 if(!['course_orientation','course_review','course_source'].includes(s.stage)){
  reviews=`<details data-source-review="story"><summary>回看本课事件／任务</summary>${text(story)}</details>`;
  if(row?.teaching_viewed_at)reviews+=`<details data-source-review="teaching"><summary>回看已经学过的方法</summary>${text(teaching)}</details>`;
  if(row?.change_feedback_viewed_at)reviews+=`<details data-source-review="change"><summary>回看条件变化的讲解</summary>${text(changeInfo)}${reviewed||s.arm==='A'&&[1,2].includes(s.visit)?text(changeQuestion):''}${text(changeFeedback)}</details>`;
 }
 return `<section class="source-training" data-copy-version="${SOURCE_COPY_VERSION}">${header}${reviews}${body}</section>`;
}
export function bindSourceTraining(root,s,c,send){
 const f=root.querySelector('#source-form');
 if(f){
  f.querySelectorAll('textarea').forEach(t=>t.addEventListener('input',()=>{if(t.value.trim())f.elements['status'+t.name.slice(5)].value='text';}));
  f.onsubmit=e=>{e.preventDefault();const data=new FormData(f),count=Number(f.dataset.count);send({type:f.dataset.kind,writes:Array.from({length:count},(_,i)=>({status:data.get('status'+i),text:data.get('write'+i)})),...(f.dataset.kind==='course_review'?{practice_status:data.get('practice_status')}:{}),...(f.dataset.kind==='course_revision'?{mode:data.get('mode')}: {})});};
 }
 root.querySelectorAll('[data-course-experience]').forEach(b=>b.onclick=()=>send({type:'course_experience',id:c.course_experience[s.index].id,value:b.dataset.courseExperience==='skip'?null:Number(b.dataset.courseExperience)}));
 root.querySelectorAll('[data-source-review]').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)send({type:'review_view',section:d.dataset.sourceReview});}));
}
