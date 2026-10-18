// Convert the user-approved six-course manuscript into display-only content.
export function parseReviewedCopy(markdown) {
 const sections = Object.fromEntries([...markdown.matchAll(/^### ((?:[AB][1-4]|C)-\d{2}) ([^\n]+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)].map(m => [m[1], m[3].trim()]));
 const ids = ['A3','A4','B1','B2','B3','B4'];
 if (Object.keys(sections).length !== 68) throw Error('应有六课60节和共用提示8节');
 const courses = {};
 for (const id of ids) {
  const sec = n => { const value = sections[`${id}-${String(n).padStart(2,'0')}`]; if (!value) throw Error('缺少课程节 '+id+n); return value; };
  const questions = value => {
   const match = value.match(/^第一题：([\s\S]*?)\n\n第二题：([\s\S]*)$/m);
   if (!match) throw Error('两题结构不符 '+id);
   return [match[1].trim(),match[2].trim()];
  };
  const change = sec(4).split('\n\n提交后讲解：');
  if (change.length !== 2) throw Error('条件讲解结构不符 '+id);
  const [info,...question] = change[0].split('\n\n');
  if (!question.length) throw Error('条件问题缺失 '+id);
  courses[id] = {
   story:sec(1), initial:questions(sec(2)), teaching:sec(3),
   change_prompt:info, change_question:question.join('\n\n'), change_feedback:change[1],
   reflection:sec(5), application_story:sec(6).split('\n\n第一题：')[0],
   application:questions(sec(6)), feedback:sec(7), revision_intro:sec(8),
   card:sec(9), homework:sec(10)
  };
 }
 const c = n => sections['C-'+String(n).padStart(2,'0')];
 const labeled = (value,label) => {const match=value.match(new RegExp('^'+label+'：([^\\n]+)','m'));if(!match)throw Error('缺少提示 '+label);return match[1];};
 return { courses, common:{
  orientation:c(1), review:c(2).split('\n\n')[0],
  review_a:labeled(c(2),'实验组短答'), review_b:labeled(c(2),'对照组短答'),
  review_missing:c(2).split('**学生可见提示：** ')[1],
  initial:c(3), teaching:c(4), application_a:labeled(c(5),'实验组'),application_b:labeled(c(5),'对照组'),
  revision_input:c(6).split('\n\n')[0],comment:c(7),homework_notice:c(8).split('\n\n')[0]
 }};
}
