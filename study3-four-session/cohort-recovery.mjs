// Teacher-assisted recovery. Student number is read from stdin, never printed.
// Creates one short-lived link without modifying answers, groups or visits.
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {openCohortStore} from './cohort-store.mjs';
const out=process.env.S3_RECOVERY_OUTPUT;if(!out||existsSync(out))throw Error('恢复文件必须为新的私有文件');
const role=process.env.S3_ENVIRONMENT,number=readFileSync(0,'utf8').trim();
const store=openCohortStore({dataDir:process.env.S3_DATA_DIR,role,enabled:true});
try{const token=store.issueRecovery(number);writeFileSync(out,'仅发给已核实身份的本人，15分钟内使用一次。填写原学号后恢复原进度，不重新分组。\nhttps://101.34.238.243/study3/'+role.toLowerCase()+'/pre/#recovery='+token+'\n',{flag:'wx',mode:0o600});console.log('已保存一次性恢复链接；没有修改任何回答或组别。');}finally{store.close();}
