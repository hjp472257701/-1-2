// Reuses approved UI and course/measurement text; only infrastructure chrome differs.
export const PARTICIPATION='本次为研究三小规模预测试，用于检查课程理解、操作流程和数据收集。你将完成问卷、四次学习活动及任务；任务中的人物、合作和积分由程序模拟，不影响真实同学的成绩或收入。部分问题可能让人不舒服，可以暂不回答、随时停止。是否参加不影响成绩或评价。数据仅用于本研究准备与分析，不作为品德评价；预测试不自动并入正式样本。请勿写姓名、学号、他人隐私或可识别的私人经历。每次均使用组织者单独发给你的同一测试号码，不要转发。记录由研究者受控保存和导出。若想撤回或有疑问，请通过发放链接的组织者联系；已匿名化或已导出的资料可能无法全部追回。四课安排在约一周内，后续问卷安排在末课两周后。正式招募条件、保存期限和研究负责人联系方式应由组织者在招募说明中另行明确。';
export function cohortSource(name,source,base,role){
 if(name==='index.html')return source.replaceAll('href="/','href="'+base).replaceAll('src="/','src="'+base);
 if(name==='entry.mjs')return source.replace("export const BASE='/study3-four-session/';","export const BASE='"+base+"';").replace("BASE+'measurement/pre/'","BASE+'pre/'").replace("BASE+'measurement/mid/'","BASE+'mid/'").replace("BASE+'measurement/post/'","BASE+'post/'").replace('export const previewByPath=path=>ENTRIES.find(x=>previewPath(x)===path)??null;','export const previewByPath=()=>null;').replaceAll('前测','问卷填写').replaceAll('中测 · 四次练习结束','问卷填写').replaceAll('后测 · 结束两周后','问卷填写');
 if(name!=='app.mjs')return source;
 source=source.replaceAll("from '/","from '"+base).replace("fetch(PREVIEW?'/api/preview/content':'/content.json')","fetch('"+base+"content.json')").replace('fetch(path,{',"fetch('"+base+"'+path.replace(/^\\//,''),{");
 const mode=role==='PILOT'?'预测试':'正式研究（尚未开放）';
 const frame=`function frame(body){return '<h1>事件理解与学习活动</h1><p class="muted">${mode} · 每次使用组织者发给你的同一测试号码。已提交内容会保存；未提交文字不保证保存。</p>'+(warning?'<p class="error" role="alert">'+esc(warning)+'</p>':'')+body+(S?'<div class="footer">'+button('保存并暂停','data-common="pause"')+button('返回号码入口','data-common="leave"')+'</div>':'');}\n`;
 source=source.replace(/function frame\(body\)\{[\s\S]*?(?=const entryLinks)/,frame);
 const consent='<div class="panel"><h3>参加说明</h3><p>'+PARTICIPATION+'</p></div><label><input name="confirm_number" type="checkbox" required>我已核对号码，之后每次都会使用同一号码，不填写学号。</label><label><input name="consent" type="checkbox" required>我已阅读参加说明，自愿参加；我知道可以停止或跳答。</label>';
 source=source.replace('placeholder="例如 NEW001"','placeholder="组织者单独发给你的专用号码"').replace("${button('进入','class=\"primary\"')}</form>`);\n resetPageScroll();",consent+"${button('进入','class=\"primary\"')}</form>`);\n resetPageScroll();");
 source=source.replace("{...Object.fromEntries(f),entry_id:ENTRY?.id}","{test_number:f.get('test_number'),entry_id:ENTRY?.id,confirm_number:f.get('confirm_number')==='on',consent:f.get('consent')==='on'?'S3-PILOT-PARTICIPATION-v1':null}");
 source=source.replace("+button('仅演示：提前体验'+ENTRY.label,'data-start=\"demo\"')",'').replace("demo_override:b.dataset.start==='demo'",'').replace("demo_override:b.dataset.override==='true'",'');
 source=source.replace("${button('仅演示：跳过剩余时间（会标记）','id=\"interval-fast\"')}",'');
 source=source.replace('确认本次环节后开始；日期快进仅用于本地演示。','按本次安排开始；日期由服务器核对，不能提前跳过。').replace('只需填写原测试号码，进入并继续已保存的进度。','填写组织者发给你的原测试号码，核对无误后进入；不创建账号，不自行换号。');
 return source;
}
