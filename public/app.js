import {api,get,post,loadScript} from './api.js';
const $=id=>document.getElementById(id);
let scene=null, source=null, current=null, busy=false, runId=0, libraries=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const status=(id,msg)=>{$(id).textContent=msg};
function libs(){return libraries??=(async()=>{await loadScript('/vendor/aframe.min.js');await loadScript('/vendor/mindar-image-aframe.prod.js')})().catch(e=>{libraries=null;throw e});}
function make(tag,attrs={},parent){const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent?.appendChild(e);return e;}
function gift(anchor){
  const root=make('a-entity',{position:'0 0 0.04'},anchor);
  const material='color: #18171a; metalness: 0.18; roughness: 0.55';
  const gold='color: #e8b85a; metalness: 0.55; roughness: 0.24';
  make('a-box',{width:'.58',height:'.42',depth:'.44',position:'0 -.02 .23',material,class:'gift-hit'},root);
  make('a-box',{width:'.12',height:'.425',depth:'.447',position:'0 -.02 .23',material:gold},root);
  const lid=make('a-entity',{position:'0 .23 .23'},root);
  make('a-box',{width:'.62',height:'.10',depth:'.48',material,class:'gift-hit'},lid);
  make('a-box',{width:'.12',height:'.105',depth:'.485',material:gold},lid);
  make('a-box',{width:'.625',height:'.105',depth:'.12',material:gold},lid);
  for(const x of [-.09,.09])make('a-torus',{radius:'.075','radius-tubular':'.022',position:`${x} .10 0`,rotation:`0 0 ${x<0?-35:35}`,scale:'1 0.65 1',material:gold},lid);
  return {root,lid};
}
function stopCamera(){
  runId++;current=null;
  try{scene?.systems?.['mindar-image-system']?.stop()}catch{}
  if(scene){scene.remove();scene=null}
  // MindAR may insert a video next to the scene; also stop any surviving track.
  $('camera').querySelectorAll('video').forEach(v=>{v.srcObject?.getTracks?.().forEach(t=>t.stop());v.remove()});
  $('camera').replaceChildren();$('camera').hidden=true;$('scanner').hidden=true;
  if(source){URL.revokeObjectURL(source);source=null}
}
function showIntro(){stopCamera();$('modal').hidden=true;$('intro').hidden=false;$('start').disabled=false;busy=false;status('intro-status','')}
async function start(){
  if(busy)return;busy=true;$('start').disabled=true;const run=++runId;
  status('intro-status','იტვირთება პოსტერების მონაცემები…');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('კამერისთვის საჭიროა HTTPS და მხარდაჭერილი ბრაუზერი.');
    const catalog=await get('catalog');
    if(!catalog.ids.length)throw new Error('პოსტერები ჯერ არ არის დამატებული.');
    await libs();
    const parts=await Promise.all(Array.from({length:catalog.chunks},(_,i)=>api('chunk',{query:{version:catalog.version,part:i}}).then(r=>r.arrayBuffer())));
    if(run!==runId)return;
    source=URL.createObjectURL(new Blob(parts,{type:'application/octet-stream'}));
    $('intro').hidden=true;$('camera').hidden=false;$('scanner').hidden=false;$('frame').hidden=false;$('open-gift').hidden=true;status('scan-status','იტვირთება კამერა…');$('scan-status').hidden=false;
    const ar=make('a-scene',{'embedded':'','mindar-image':`imageTargetSrc: ${source}; autoStart: false; uiLoading: no; uiScanning: no; uiError: no; maxTrack: 1`,'color-space':'sRGB',renderer:'colorManagement: true; alpha: true; antialias: true','vr-mode-ui':'enabled: false','device-orientation-permission-ui':'enabled: false'});
    scene=ar;ar.style.cssText='width:100%;height:100%;position:absolute;inset:0;';
    make('a-camera',{position:'0 0 0','look-controls':'enabled: false',cursor:'rayOrigin: mouse; fuse: false',raycaster:'objects: .gift-hit'},ar);
    catalog.ids.forEach((id,index)=>{
      const anchor=make('a-entity',{'mindar-image-target':`targetIndex: ${index}`},ar),box=gift(anchor);
      const entry={id,...box};
      anchor.addEventListener('targetFound',()=>{if(run!==runId||busy)return;current=entry;$('frame').hidden=true;$('open-gift').hidden=false;$('scan-status').hidden=true});
      anchor.addEventListener('targetLost',()=>{if(current===entry&&!busy){current=null;$('frame').hidden=false;$('open-gift').hidden=true;$('scan-status').hidden=false;status('scan-status','მიუშვირე კამერა პოსტერს')}});
      box.root.addEventListener('click',()=>{if(current===entry)openGift()});
    });
    let started=false;
    function startAR(){if(started||run!==runId)return;started=true;busy=false;try{Promise.resolve(ar.systems['mindar-image-system'].start()).catch(cameraError)}catch(e){cameraError(e)}}
    function cameraError(){if(run!==runId)return;showIntro();status('intro-status','კამერა ვერ ჩაირთო. მიეცით კამერის ნებართვა და სცადეთ ხელახლა.');}
    ar.addEventListener('arReady',()=>{if(run===runId&&!current)status('scan-status','მიუშვირე კამერა პოსტერს')});
    ar.addEventListener('arError',cameraError);
    ar.addEventListener('loaded',startAR,{once:true});
    $('camera').append(ar);if(ar.hasLoaded)startAR();
  }catch(e){if(run===runId){showIntro();status('intro-status',e.message)}}
}
function confetti(){const wrap=document.createElement('div');wrap.className='confetti';for(let i=0;i<65;i++){const x=document.createElement('i');x.style.left=`${Math.random()*100}%`;x.style.animationDelay=`${Math.random()*.5}s`;x.style.setProperty('--drift',`${Math.random()*170-85}px`);x.style.background=['#e7c477','#fff6d7','#90d7ab'][i%3];wrap.append(x)}document.body.append(wrap);setTimeout(()=>wrap.remove(),2500)}
let selectedId=null;
function showResult(data,id){
  stopCamera();busy=false;selectedId=id;const won=data.outcome==='win';
  $('result-icon').textContent=won?'🎉':'🎁';$('result-title').textContent=won?'გილოცავთ! თქვენ მოიგეთ პოსტერის ღირებულება':'ამჯერად არ გაგიმართლათ!';
  $('result-title').style.color=won?'var(--gold)':'';status('result-message',won?(data.paid?'ამ პოსტერის პრიზი უკვე გაცემულია.':'პოსტერის ღირებულება სრულად დაგიბრუნდებათ შეკვეთის გადამოწმების შემდეგ.'):'მადლობა, რომ აირჩიეთ WestFace.');
  $('claim-open').hidden=!won||data.paid;$('claim-form').hidden=true;$('claim-form').reset();status('claim-status','');$('modal').hidden=false;if(won&&!data.paid)confetti();
}
async function openGift(){
  if(busy||!current)return;busy=true;const entry=current,run=runId;$('open-gift').disabled=true;
  try{
    const request=post('reveal',{id:entry.id});
    entry.lid.setAttribute('animation__up','property: position; to: 0.08 0.62 0.35; dur: 650; easing: easeOutCubic');
    entry.lid.setAttribute('animation__turn','property: rotation; to: -35 0 25; dur: 650; easing: easeOutCubic');
    const [data]=await Promise.all([request,wait(850)]);if(run===runId)showResult(data,entry.id);
  }catch(e){if(run===runId){entry.lid.removeAttribute('animation__up');entry.lid.removeAttribute('animation__turn');entry.lid.setAttribute('position','0 .23 .23');entry.lid.setAttribute('rotation','0 0 0');busy=false;$('scan-status').hidden=false;status('scan-status',e.message);}}
  finally{$('open-gift').disabled=false}
}
$('start').addEventListener('click',start);$('exit').addEventListener('click',showIntro);$('open-gift').addEventListener('click',openGift);$('again').addEventListener('click',showIntro);
$('claim-open').addEventListener('click',()=>{$('claim-open').hidden=true;$('claim-form').hidden=false;$('claim-form').elements.name.focus()});
$('claim-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;status('claim-status','იგზავნება…');try{await post('claim',{id:selectedId,name:form.elements.name.value,phone:form.elements.phone.value,consent:form.elements.consent.checked});form.hidden=true;status('claim-status','განაცხადი მიღებულია. WestFace დაგიკავშირდებათ.');}catch(err){status('claim-status',err.message)}finally{button.disabled=false}});
window.addEventListener('pagehide',stopCamera);
