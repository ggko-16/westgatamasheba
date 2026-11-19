import {api,endpoint,get,post,upload} from './api.js';
const $=id=>document.getElementById(id);
let info=null,previewUrl=null,saving=false;
const set=(id,value)=>{$(id).textContent=value};
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
function placeholder(container,message){container.append(node('p','muted',message))}
function session(show){$('login').hidden=show;$('dashboard').hidden=!show;$('logout').hidden=!show;$('loading').hidden=true}
function stat(label,value){const e=node('div','stat');e.append(node('span','muted',label),node('b','',value));return e;}
function draw(){
  const {catalog,claims,paid}=info,items=catalog.items,paidCount=Object.values(paid).filter(Boolean).length;
  $('stats').replaceChildren(stat('პოსტერები',items.length),stat('მოგებული პოსტერები',items.filter(x=>x.outcome==='win').length),stat('განაცხადები',claims.length),stat('გაცემულია',`${paidCount*45} ₾`));
  const posters=$('posters');posters.replaceChildren();if(!items.length)placeholder(posters,'ჯერ პოსტერი არ დაგიმატებია.');
  [...items].reverse().forEach(p=>{const row=node('div','item'),img=node('img');img.src=endpoint('image',{id:p.id});img.alt=p.name;img.loading='lazy';const details=node('div','grow');details.append(node('strong','',p.name),node('p','muted',paid[p.id]?'პრიზი გაცემულია':'გამოქვეყნებულია'));row.append(img,details,node('span',`pill ${p.outcome==='win'?'win':''}`,p.outcome==='win'?'45 ₾':'არ მოიგო'));posters.append(row)});
  const list=$('claims');list.replaceChildren();if(!claims.length)placeholder(list,'ჯერ მოგების მოთხოვნა არ შემოსულა.');
  claims.forEach(c=>{const row=node('div','item'),img=node('img');img.src=endpoint('image',{id:c.posterId});img.alt=c.posterName;img.loading='lazy';const detail=node('div','grow');detail.append(node('strong','',c.name),node('p','muted',`${c.phone} · ${c.posterName}`),node('p','muted',new Date(c.createdAt).toLocaleString('ka-GE',{timeZone:'Asia/Tbilisi'})));const payment=paid[c.posterId];row.append(img,detail,node('strong','',`${c.amount} ₾`));if(payment)row.append(node('span','pill win',payment.claimId===c.id?'გადარიცხულია':'ამ პოსტერის პრიზი გაცემულია'));else{const btn=node('button','small','თანხა გადარიცხულია');btn.addEventListener('click',async()=>{if(!confirm('დარწმუნებული ხარ, რომ შეკვეთა გადაამოწმე და 45 ₾ უკვე გადაურიცხე?'))return;btn.disabled=true;try{await post('mark-paid',{claimId:c.id});await refresh();}catch(e){set('dashboard-status',e.message);btn.disabled=false;}});row.append(btn);}list.append(row)});
}
async function refresh(){try{info=await get('admin');session(true);draw();set('dashboard-status','')}catch(e){if(e.status===401){session(false);set('login-status','')}else{$('loading').hidden=false;set('loading',e.message)}}}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('button');b.disabled=true;set('login-status','');try{await post('login',{password:form.elements.password.value});form.reset();await refresh()}catch(err){set('login-status',err.message)}finally{b.disabled=false}});
$('logout').addEventListener('click',async()=>{try{await post('logout');location.reload()}catch(e){set('dashboard-status',e.message)}});
$('refresh').addEventListener('click',refresh);
$('poster-form').elements.image.addEventListener('change',e=>{if(previewUrl)URL.revokeObjectURL(previewUrl);const file=e.target.files[0];$('preview').hidden=!file;if(file){previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl}});
function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('ფოტო ვერ გაიხსნა'));img.src=src})}
async function resizeImage(file){const url=URL.createObjectURL(file);try{const img=await loadImage(url);if(img.width<180||img.height<180)throw new Error('ფოტო ძალიან პატარაა.');const scale=Math.min(1,650/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('ფოტოს დამუშავება ვერ მოხერხდა')),'image/jpeg',.88))}finally{URL.revokeObjectURL(url)}}
$('poster-form').addEventListener('submit',async e=>{
  e.preventDefault();if(saving)return;saving=true;
  const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
  const file=form.elements.image.files[0],name=form.elements.title.value.trim(),outcome=form.elements.outcome.value;
  const urls=[];
  try{
    if(!info||!file||!name)return;
    if(info.catalog.items.length>=40)throw new Error('ამ ვერსიაში მაქსიმუმ 40 განსხვავებული პოსტერია მხარდაჭერილი.');
    set('publish-status','ფოტო მუშავდება…');
    const resized=await resizeImage(file),imageUrl=URL.createObjectURL(resized);urls.push(imageUrl);
    const existing=await Promise.all(info.catalog.items.map(async p=>{const response=await api('image',{query:{id:p.id}});const u=URL.createObjectURL(await response.blob());urls.push(u);return loadImage(u)}));
    const newImage=await loadImage(imageUrl);
    const {Compiler}=await import('/vendor/mindar-image.prod.js');
    const compiler=new Compiler();set('publish-status','იქმნება AR ამოცნობის ფაილი…');
    await compiler.compileImageTargets([...existing,newImage],p=>set('publish-status',`AR დამუშავება: ${Math.round(p)}%`));
    const buffer=await compiler.exportData(),blob=new Blob([buffer]);
    const size=1200000,chunks=Math.ceil(blob.size/size);if(!chunks||chunks>60)throw new Error('AR ბაზა ზედმეტად დიდია.');
    const id=crypto.randomUUID(),version=crypto.randomUUID();
    set('publish-status','იტვირთება პოსტერი…');await upload('upload-image',{id},resized);
    for(let i=0;i<chunks;i++){set('publish-status',`იტვირთება AR ფაილი: ${i+1}/${chunks}`);await upload('upload-chunk',{version,part:i},blob.slice(i*size,(i+1)*size));}
    await post('publish',{baseVersion:info.catalog.version,version,chunks,items:[...info.catalog.items,{id,name,outcome}]});
    form.reset();$('preview').hidden=true;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}set('publish-status','პოსტერი წარმატებით დაემატა!');await refresh();
  }catch(err){set('publish-status',err.message||'პოსტერის შენახვა ვერ მოხერხდა.')}finally{urls.forEach(u=>URL.revokeObjectURL(u));saving=false;button.disabled=false;}
});
refresh();
