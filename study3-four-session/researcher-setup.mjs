// Run on the server only; never print or commit the generated password.
import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
const dir=process.env.S3_DATA_DIR;if(!dir)throw Error('S3_DATA_DIR required');
const target=join(dir,'researcher-password.json');if(existsSync(target))throw Error('Researcher password already configured; refusing to replace it');
const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
writeFileSync(target,JSON.stringify({salt,hash:scryptSync(password,salt,32).toString('hex')}),{mode:0o600,flag:'wx'});
writeFileSync(join(dir,'researcher-access.txt'),'研究三研究者管理入口\nhttps://101.34.238.243/study3/researcher/\n\n研究者密码：'+password+'\n\n请勿发给学生、提交GitHub或公开分享。仅能导出研究三技术测试记录。\n',{mode:0o600,flag:'wx'});
console.log('Researcher credentials configured; secret remains in private access file.');
