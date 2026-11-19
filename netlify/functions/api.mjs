import { getStore } from '@netlify/blobs';
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const idOk = x => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x);
const textOk = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max;
const indexOk = x => /^\d{1,2}$/.test(x ?? '') && Number(x) < 60;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status=200, more={}) => Response.json(body, { status, headers: {...headers,...more} });
const fail = (msg, status=400) => json({error:msg},status);
const binary = (data, type) => data ? new Response(data,{headers:{...headers,'Content-Type':type}}) : fail('ფაილი ვერ მოიძებნა',404);
const initial = () => ({version:null,chunks:0,items:[]});
const safeEq = (a,b) => { const x=Buffer.from(a??''),y=Buffer.from(b??''); return x.length===y.length && timingSafeEqual(x,y); };
const sign = (value,secret) => createHmac('sha256',secret).update(value).digest('base64url');
const cookie = (value, maxAge) => `wf_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const hash = (str) => createHash('sha256').update(str).digest('hex');

export function authorized(req, secret, now=Date.now()) {
  if (!secret || secret.length<32) return false;
  const token = (req.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wf_admin='))?.slice(9)??'';
  const [expiry,nonce,signature,...rest]=token.split('.');
  return !rest.length && /^\d+$/.test(expiry??'') && /^[a-f0-9]{32}$/.test(nonce??'') && Number(expiry)>now && safeEq(signature,sign(`${expiry}.${nonce}`,secret));
}
export function publicCatalog(catalog) {
  return {version:catalog.version,chunks:catalog.chunks,ids:catalog.items.map(x=>x.id)};
}
export function normalizePhone(input) {
  if (typeof input!=='string') return null;
  let phone=input.replace(/[\s()-]/g,'');
  if (/^5\d{8}$/.test(phone)) phone='+995'+phone;
  if (/^9955\d{8}$/.test(phone)) phone='+'+phone;
  return /^\+9955\d{8}$/.test(phone)?phone:null;
}
const getJSON = (store,key) => store.get(key,{type:'json'});
const listPrefix = async (store,prefix) => {
  const result=[];
  for await (const page of store.list({prefix,paginate:true})) result.push(...page.blobs);
  return result;
};
async function body(req,max=30000) {
  const raw=await req.text();
  if(raw.length>max) throw new Error('REQUEST_TOO_LARGE');
  try{return JSON.parse(raw)}catch{throw new Error('INVALID_JSON')}
}
async function upload(req,max) {
  const bytes=await req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength>max) throw new Error('REQUEST_TOO_LARGE');
  return bytes;
}

// Injectable store makes the workflow testable without a live Netlify account.
export function createHandler(storeFactory, env=process.env) {
  return async function handler(req) {
    try {
      const url=new URL(req.url), action=url.searchParams.get('action')??'', method=req.method;
      const write=method==='POST';
      if(!['GET','POST'].includes(method)) return fail('მეთოდი არ არის მხარდაჭერილი',405);
      if(write && req.headers.get('origin')!==url.origin) return fail('არასწორი წყარო',403);
      const secret=env.SESSION_SECRET??'', password=env.ADMIN_PASSWORD??'';
      const store=storeFactory();
      const auth=authorized(req,secret);
      const adminActions=['admin','image','upload-image','upload-chunk','publish','mark-paid','logout'];
      if(adminActions.includes(action)&&!auth) return fail('გაიარეთ ავტორიზაცია',401);
      if(action==='login'&&write) {
        if(secret.length<32||password.length<12) return fail('სერვერის ადმინისტრირების პარამეტრები არ არის გამართული',503);
        const b=await body(req);
        if(typeof b.password!=='string'||!safeEq(hash(b.password),hash(password))) return fail('არასწორი პაროლი',401);
        const expiry=Date.now()+8*60*60*1000, nonce=randomBytes(16).toString('hex'), value=`${expiry}.${nonce}`;
        return json({ok:true},200,{'Set-Cookie':cookie(`${value}.${sign(value,secret)}`,28800)});
      }
      if(action==='logout'&&write) return json({ok:true},200,{'Set-Cookie':cookie('',0)});
      if(action==='catalog'&&method==='GET') return json(publicCatalog(await getJSON(store,'catalog')??initial()));
      if(action==='chunk'&&method==='GET') {
        const version=url.searchParams.get('version'),part=url.searchParams.get('part');
        if(!idOk(version)||!indexOk(part))return fail('არასწორი ფაილი');
        return binary(await store.get(`targets/${version}/${Number(part)}`,{type:'arrayBuffer'}),'application/octet-stream');
      }
      if(action==='reveal'&&write) {
        const b=await body(req), catalog=await getJSON(store,'catalog')??initial();
        const poster=catalog.items.find(x=>x.id===b.id);
        if(!poster)return fail('პოსტერი ვერ მოიძებნა',404);
        const paid=poster.outcome==='win' && Boolean(await getJSON(store,`paid/${poster.id}`));
        return json({outcome:poster.outcome,amount:poster.outcome==='win'?45:0,paid});
      }
      if(action==='claim'&&write) {
        const b=await body(req), catalog=await getJSON(store,'catalog')??initial();
        const poster=catalog.items.find(x=>x.id===b.id);
        if(!poster||poster.outcome!=='win')return fail('ამ პოსტერზე პრიზი არ არის',403);
        if(await getJSON(store,`paid/${poster.id}`))return fail('ამ პოსტერის პრიზი უკვე გაცემულია',409);
        const phone=normalizePhone(b.phone);
        if(!textOk(b.name,80)||!phone||b.consent!==true)return fail('შეავსეთ სახელი, ნომერი და თანხმობა');
        const key=`claims/${poster.id}/${hash(phone).slice(0,32)}`;
        const claim={id:key,posterId:poster.id,posterName:poster.name,name:b.name.trim(),phone,amount:45,createdAt:new Date().toISOString()};
        const saved=await store.setJSON(key,claim,{onlyIfNew:true});
        return json({ok:true,duplicate:!saved.modified});
      }
      if(action==='admin'&&method==='GET') {
        const catalog=await getJSON(store,'catalog')??initial();
        const keys=await listPrefix(store,'claims/');
        const claims=(await Promise.all(keys.map(x=>getJSON(store,x.key)))).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
        const paid=Object.fromEntries(await Promise.all(catalog.items.map(async x=>[x.id,await getJSON(store,`paid/${x.id}`)])));
        return json({catalog,claims,paid});
      }
      if(action==='image'&&method==='GET') {
        const id=url.searchParams.get('id'); if(!idOk(id))return fail('არასწორი ფოტო');
        return binary(await store.get(`images/${id}`,{type:'arrayBuffer'}),'image/jpeg');
      }
      if(action==='upload-image'&&write) {
        const id=url.searchParams.get('id'); if(!idOk(id))return fail('არასწორი ფოტო');
        const data=await upload(req,800000), bytes=new Uint8Array(data);
        if(bytes[0]!==255||bytes[1]!==216)return fail('საჭიროა JPEG ფოტო');
        const result=await store.set(`images/${id}`,data,{onlyIfNew:true});
        return result.modified?json({ok:true}):fail('ფოტო უკვე არსებობს',409);
      }
      if(action==='upload-chunk'&&write) {
        const version=url.searchParams.get('version'),part=url.searchParams.get('part');
        if(!idOk(version)||!indexOk(part))return fail('არასწორი სამიზნე');
        const result=await store.set(`targets/${version}/${Number(part)}`,await upload(req,1500000),{onlyIfNew:true});
        return result.modified?json({ok:true}):fail('ნაწილი უკვე არსებობს',409);
      }
      if(action==='publish'&&write) {
        const b=await body(req,80000), current=await store.getWithMetadata('catalog',{type:'json'}), old=current?.data??initial();
        if(b.baseVersion!==old.version)return fail('მონაცემები განახლდა. გადატვირთეთ გვერდი',409);
        if(!idOk(b.version)||!Number.isInteger(b.chunks)||b.chunks<1||b.chunks>60||!Array.isArray(b.items)||b.items.length!==old.items.length+1||b.items.length>40)return fail('არასწორი კატალოგი ან ლიმიტი');
        if(old.items.some((x,i)=>JSON.stringify(x)!==JSON.stringify(b.items[i])))return fail('უკვე გამოქვეყნებული შედეგი არ იცვლება',409);
        const newPoster=b.items.at(-1);
        if(!idOk(newPoster?.id)||!textOk(newPoster.name,100)||!['win','lose'].includes(newPoster.outcome)||old.items.some(x=>x.id===newPoster.id))return fail('არასწორი პოსტერი');
        if(!await store.get(`images/${newPoster.id}`,{type:'arrayBuffer'}))return fail('ფოტო არ მოიძებნა');
        for(let i=0;i<b.chunks;i++)if(!await store.get(`targets/${b.version}/${i}`,{type:'arrayBuffer'}))return fail('AR ფაილი არასრულია');
        const catalog={version:b.version,chunks:b.chunks,items:[...old.items,{id:newPoster.id,name:newPoster.name.trim(),outcome:newPoster.outcome}]};
        const result=await store.setJSON('catalog',catalog,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
        return result.modified?json({ok:true}):fail('მონაცემები შეიცვალა; სცადეთ თავიდან',409);
      }
      if(action==='mark-paid'&&write) {
        const b=await body(req);
        if(typeof b.claimId!=='string'||!/^claims\/[a-f0-9-]{36}\/[a-f0-9]{32}$/.test(b.claimId))return fail('არასწორი განაცხადი');
        const claim=await getJSON(store,b.claimId); if(!claim)return fail('განაცხადი ვერ მოიძებნა',404);
        const result=await store.setJSON(`paid/${claim.posterId}`,{claimId:claim.id,paidAt:new Date().toISOString(),amount:45},{onlyIfNew:true});
        return result.modified?json({ok:true}):fail('ამ პოსტერის პრიზი უკვე დაფიქსირებულია',409);
      }
      return fail('გვერდი ვერ მოიძებნა',404);
    }catch(error){
      if(['REQUEST_TOO_LARGE','INVALID_JSON'].includes(error.message))return fail('მონაცემები არასწორია ან ფაილი ზედმეტად დიდია',400);
      console.error('WestFace API:',error?.message);
      return fail('სერვერის შეცდომა. სცადეთ ხელახლა.',500);
    }
  };
}
export default createHandler(()=>getStore({name:'westface-mystery-v1',consistency:'strong'}));
