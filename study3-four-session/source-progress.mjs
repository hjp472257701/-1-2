// Local, test-only draft recovery. No number or private reflection is stored.
const prefix='s3-v9-draft:';
const key=s=>prefix+[s.id,s.stage,s.step,s.index,s.visit].join(':');
export function bindSourceDraft(root,s){
 const form=root.querySelector('#source-form');if(!form)return;
 try{const saved=JSON.parse(sessionStorage.getItem(key(s))??'null');if(saved)for(const element of form.elements){if(!element.name||!Object.hasOwn(saved,element.name))continue;if(element.type==='radio')element.checked=element.value===saved[element.name];else element.value=saved[element.name];}}catch{}
 const save=()=>{try{sessionStorage.setItem(key(s),JSON.stringify(Object.fromEntries(new FormData(form))));}catch{}};
 form.addEventListener('input',save);form.addEventListener('change',save);
}
export function clearSourceDraft(s){try{sessionStorage.removeItem(key(s));}catch{}}
let activeMs=0,hiddenCount=0,lastTick=Date.now(),lastInteraction=Date.now(),resumed=true;
for(const name of ['pointerdown','keydown','scroll','input'])document.addEventListener(name,()=>{lastInteraction=Date.now();},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenCount++;lastTick=Date.now();});
setInterval(()=>{const now=Date.now(),delta=now-lastTick;lastTick=now;if(!document.hidden&&now-lastInteraction<=60000)activeMs+=Math.max(0,Math.min(delta,1500));},1000);
export function takeEngagement(){const value={active_ms:Math.min(3600000,Math.round(activeMs)),hidden_count:hiddenCount,resumed};activeMs=0;hiddenCount=0;resumed=false;return value;}
