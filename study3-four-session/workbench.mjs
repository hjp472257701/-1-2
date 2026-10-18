export function workbenchResult(kind,writes){
 const value=i=>{const w=writes[i];return w?.status==='skip'?'暂不回答':w?.status==='cant_think'?'暂时想不到':w?.text?.trim()||'等待你填写';};
 const first=value(0),second=value(1);
 const lookup=()=>{if(writes.some(w=>w.status!=='text'||!w.text.trim()))return '先填文件名称和查找词，再查看模拟结果。';const leaf=writes[0].text.trim().split(/[／/]/).at(-1).toLocaleLowerCase(),keyword=writes[1].text.trim().toLocaleLowerCase();return leaf.includes(keyword)?'模拟找到：'+writes[0].text.trim():'这个关键词还没有匹配到你填写的文件名，可以再检查一下。';};
 if(kind==='rename_search')return [['整理后的文件',first],['网页模拟查找',lookup()]];
 if(kind==='folder_reason')return [['你安排的文件夹位置',first],['你写的分类依据',second]];
 if(kind==='version_archive')return [['你选的当前文件',first],['旧版的归档位置',second]];
 if(kind==='path_search')return [['你安排的完整位置',first],['网页模拟查找',lookup()]];
 return [['你对理由的判断',first],['你准备采取的做法',second]];
}
