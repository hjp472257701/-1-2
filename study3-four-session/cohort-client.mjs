// Reuses approved UI and course/measurement text; only infrastructure chrome differs.
export const PARTICIPATION_VERSION='S3-PARTICIPATION-v3';
export const PARTICIPATION='本活动包括问卷、四次学习活动及任务。任务中的人物、合作和积分由程序模拟，不影响真实同学的成绩或收入。部分问题可能让人不舒服，可以暂不回答或停止，是否参加不影响成绩或评价。回答仅用于本研究，不作为品德评价。测试号码填写本人学号，用于关联各次记录；不要在具体回答中写姓名、学号、他人隐私或可识别的私人经历。请尽量使用同一设备和同一浏览器参加。如果有疑问，可以告知老师，由老师帮忙反馈。';
export function cohortSource(name,source,base,role){
 if(name==='index.html')return source.replaceAll('href="/','href="'+base).replaceAll('src="/','src="'+base);
 if(name==='entry.mjs')return source.replace("export const BASE='/study3-four-session/';","export const BASE='"+base+"';").replace("BASE+'measurement/pre/'","BASE+'pre/'").replace("BASE+'measurement/mid/'","BASE+'mid/'").replace("BASE+'measurement/post/'","BASE+'post/'").replace('export const previewByPath=path=>ENTRIES.find(x=>previewPath(x)===path)??null;','export const previewByPath=()=>null;').replaceAll('前测','问卷填写').replaceAll('中测 · 四次练习结束','问卷填写').replaceAll('后测 · 结束两周后','问卷填写');
 if(name!=='app.mjs')return source;
 source=source.replaceAll("from '/","from '"+base).replace("fetch(PREVIEW?'/api/preview/content':'/content.json')","fetch('"+base+"content.json')").replace('fetch(path,{',"fetch('"+base+"'+path.replace(/^\\//,''),{");
 const mode='请按老师发放的链接和时间参加';
 const frame=`function frame(body){return '<h1>事件理解与学习活动</h1><p class="muted">${mode} · 每次测试号码均填本人同一学号。已提交内容会保存；未提交文字不保证保存。</p>'+(warning?'<p class="error" role="alert">'+esc(warning)+'</p>':'')+body+(S?'<div class="footer">'+button('保存并暂停','data-common="pause"')+button('返回号码入口','data-common="leave"')+'</div>':'');}\n`;
 source=source.replace(/function frame\(body\)\{[\s\S]*?(?=const entryLinks)/,frame);
 const consent='<div class="panel"><h3>参加说明</h3><p>'+PARTICIPATION+'</p></div><label><input name="confirm_number" type="checkbox" required>我已核对本人学号，之后每次都会使用同一学号。</label><label><input name="consent" type="checkbox" required>我已阅读参加说明，自愿参加；我知道可以停止或跳答。</label>';
 source=source.replace('placeholder="例如 NEW001"','placeholder="填写本人学号，保留开头的零"').replace("${button('进入','class=\"primary\"')}</form>`);\n resetPageScroll();",consent+"${button('进入','class=\"primary\"')}</form>`);\n resetPageScroll();");
 source=source.replace("{...Object.fromEntries(f),entry_id:ENTRY?.id}","{test_number:f.get('test_number'),entry_id:ENTRY?.id,confirm_number:f.get('confirm_number')==='on',consent:f.get('consent')==='on'?"+JSON.stringify(PARTICIPATION_VERSION)+":null,recovery:window.location.hash.startsWith('#recovery=')?window.location.hash.slice(10):null}");
 source=source.replace("await acceptState(x);warning='';render();","await acceptState(x);if(window.location.hash.startsWith('#recovery='))history.replaceState(null,'',window.location.pathname);warning='';render();");
 source=source.replace("+button('仅演示：提前体验'+ENTRY.label,'data-start=\"demo\"')",'').replace("demo_override:b.dataset.start==='demo'",'').replace("demo_override:b.dataset.override==='true'",'');
 source=source.replace("${button('仅演示：跳过剩余时间（会标记）','id=\"interval-fast\"')}",'');
 source=source.replace('确认本次环节后开始；日期快进仅用于本地演示。','按本次安排开始；日期由服务器核对，不能提前跳过。').replace('只需填写原测试号码，进入并继续已保存的进度。','测试号码请填本人学号，每次保持相同。无需注册；换设备或清除浏览器数据后，请联系老师协助恢复。');
 if(role==='PILOT')source=source.replace('两周后仍邀请你用同一测试号码完成追踪。今天的体验不能说明干预有效。','下一次问卷统一在11月2日20:00开放，请按老师安排，用同一测试号码参加。').replaceAll('两周追踪','后续问卷').replace('后测 · 结束两周后','问卷填写').replace('追踪按实际末课结束后14天','后续问卷统一在11月2日20:00开放');
 return source;
}
