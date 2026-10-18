// Mechanical conversion of the reviewed project manuscript; no generated questions.
export function parseSourceDraft(markdown, supplement){
 const groups={A:[],B:[]};
 for(const match of markdown.matchAll(/^### ([AB])([1-4]) (.+)\n([\s\S]*?)(?=^### [AB][1-4] |^## |$(?![\s\S]))/gm)){
  const [,arm,number,title,body]=match;
  const sections=[...body.matchAll(/^#### (\d)\. ([^\n]+)\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm)].map(m=>({number:Number(m[1]),title:m[2],text:m[3].trim()}));
  if(sections.length!==8||sections.some((s,i)=>s.number!==i+1))throw Error('课程八节不齐：'+arm+number);
  const section=n=>sections[n-1].text;
  const questions=t=>t.split(/\n\n/).filter(x=>/^问题[一二]：/.test(x)).map(x=>x.replace(/^问题[一二]：/,''));
  const change=section(4).split('提交后讲解：');
  const application=section(6).split(/\n\n问题一：/)[0];
  if(questions(section(2)).length!==2||questions(section(6)).length!==2||change.length!==2)throw Error('课程结构不符：'+arm+number);
  groups[arm].push({id:arm+number,title,sections,story:section(1),initial:questions(section(2)),teaching:section(3),change_prompt:change[0].trim(),change_feedback:change[1].trim(),reflection:section(5),application_story:application,application:questions(section(6)),feedback:section(7),card:section(8)});
 }
 if(groups.A.length!==4||groups.B.length!==4)throw Error('应有两组八课');
 const rows=supplement.split('\n').filter(x=>/^\| 第[一二三四]次 \|/.test(x));
 if(rows.length!==4)throw Error('课间应用卡不齐');
 rows.forEach((row,i)=>{const cells=row.split('|').map(x=>x.trim());groups.A[i].homework=cells[2];groups.B[i].homework=cells[3];});
 return groups;
}
