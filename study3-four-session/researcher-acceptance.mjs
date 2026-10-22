// Server-side, read-only HTTPS export acceptance. Password/cookies/data never print.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const dir=process.env.S3_DATA_DIR;if(!dir)throw Error('S3_DATA_DIR required');
const output=join(dir,'acceptance-'+Date.now());mkdirSync(output,{mode:0o700});
const ip='101.34.238.243',base='https://'+ip+'/study3/researcher/',cookie=join(output,'cookie.txt');
process.umask(0o077);
const request=(path,extra=[],input)=>execFileSync('curl',['--resolve',ip+':443:127.0.0.1','--fail','--silent','--show-error','--max-time','20','--cookie',cookie,'--cookie-jar',cookie,...extra,base+path],{input,maxBuffer:30*1024*1024});
const db=new DatabaseSync(join(dir,'preview-answers.sqlite'),{readOnly:true});
const snapshot=()=>db.prepare('SELECT id,entry,revision,state FROM preview_states ORDER BY id,entry').all();
const before=snapshot(),hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const password=readFileSync(join(dir,'researcher-access.txt'),'utf8').match(/研究者密码：([^\r\n]+)/)[1];
const login=JSON.parse(request('login',['-H','Origin: https://'+ip,'-H','Content-Type: application/json','--data-binary','@-'],JSON.stringify({password})));if(!login.ok)throw Error('login failed');
const zip=join(output,'study3-TECHNICAL-PREVIEW.zip');writeFileSync(zip,request('export.zip'),{mode:0o600});
execFileSync('unzip',['-t',zip]);
const file=name=>execFileSync('unzip',['-p',zip,name],{maxBuffer:30*1024*1024});
const full=JSON.parse(file('complete-records.json')),manifest=JSON.parse(file('manifest.json'));
if(manifest.entry_records!==before.length||full.records.length!==before.length)throw Error('record count mismatch');
for(const row of before){const state=full.records.find(x=>x.state.id===row.id&&x.state.preview_entry===row.entry)?.state;if(JSON.stringify(state)!==row.state)throw Error('original state mismatch');}
for(const name of manifest.files)if(!file(name).length)throw Error('missing file '+name);
if(!file('responses-wide.csv').toString().includes('T0__'))throw Error('missing three-wave wide columns');
if(hash(snapshot())!==hash(before))throw Error('export altered answers');
request('logout',['-H','Origin: https://'+ip,'-H','Content-Type: application/json','--data-binary','{}']);db.close();
const result={ok:true,checked_at:new Date().toISOString(),entry_records:before.length,participants:manifest.participants,files:manifest.files.length+1,zip_crc:'passed',original_states_exact_match:true,answers_unchanged:true,https_certificate_validation:true,transport:'server_loopback_HTTPS_with_public_IP_certificate_not_public_firewall_acceptance'};
writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
