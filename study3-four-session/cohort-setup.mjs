// Private enrollment list. Never prints codes or changes technical data.
import {existsSync,writeFileSync} from 'node:fs';
import {openCohortStore} from './cohort-store.mjs';
const out=process.env.S3_CODES_OUTPUT;if(!out||existsSync(out))throw Error('请指定不存在的私有号码文件；拒绝覆盖原名单');
const store=openCohortStore({role:process.env.S3_ENVIRONMENT,dataDir:process.env.S3_DATA_DIR});
try{const codes=store.issueCodes(Number(process.env.S3_CODES_COUNT??10));writeFileSync(out,'研究三预测试专用测试号码，一人一个；同一人七入口使用同号。不要公开转发。\n'+codes.map((c,i)=>(i+1)+'. '+c).join('\n')+'\n',{flag:'wx',mode:0o600});console.log('已签发独立预测试号码；仅保存在指定私有文件，未建立答卷或分组。');}finally{store.close();}
