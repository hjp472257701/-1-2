// Read-only live integration acceptance; never requests an authenticated old export.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const ip='101.34.238.243';
const curl=(url,extra=[])=>execFileSync('curl',['--fail','--silent','--show-error','--max-time','15',...extra,url],{maxBuffer:512000}).toString();
const tls=['--resolve',ip+':443:127.0.0.1'];
const original=curl('http://127.0.0.1:3001/admin');
const script=html=>[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
for(const secure of [false,true]){
 const html=curl((secure?'https://'+ip:'http://127.0.0.1')+'/admin',secure?tls:['-H','Host: '+ip]);
 assert.deepEqual(script(html),script(original));assert.match(html,/study3-management/);
 for(const entry of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post'])assert.ok(html.includes('href="/study3/try/'+entry+'/"'),entry);
 for(const [,id] of original.matchAll(/id="(download[^"]+)"/g))assert.equal((html.match(new RegExp('id="'+id+'"','g'))??[]).length,1);
 if(secure)assert.match(html,/src="\/study3\/researcher\/"/);else assert.doesNotMatch(html,/<iframe/);
}
const portal=curl('http://127.0.0.1/studies/',['-H','Host: '+ip]);
for(const entry of ['pre','practice-1','practice-2','practice-3','practice-4','mid','post']){assert.ok(portal.includes('/study3/try/'+entry+'/'));const html=curl('http://127.0.0.1/study3/try/'+entry+'/',['-H','Host: '+ip]);assert.ok(html.includes('/study3/app.mjs'));}
const frameHeaders=curl('https://'+ip+'/study3/researcher/',[...tls,'-D','-','-o','/dev/null']);assert.match(frameHeaders,/x-frame-options: SAMEORIGIN/i);assert.match(frameHeaders,/frame-ancestors 'self'/i);
console.log(JSON.stringify({ok:true,unified_admin_http:true,unified_admin_server_https:true,original_download_script_exact_match:true,original_download_buttons_preserved:true,seven_existing_links:true,frame_same_origin_only:true,queried_old_answers:false}));
