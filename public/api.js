export const endpoint=(action,query={})=>`/.netlify/functions/api?${new URLSearchParams({action,...query})}`;
export async function api(action,{method='GET',query={},data,raw}={}){
  const options={method,credentials:'same-origin'};
  if(data!==undefined){options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(data)}
  if(raw!==undefined){options.headers={'Content-Type':'application/octet-stream'};options.body=raw}
  const res=await fetch(endpoint(action,query),options);
  if(!res.ok){let message;try{message=(await res.json()).error}catch{}const e=new Error(message||`სერვერის შეცდომა (${res.status})`);e.status=res.status;throw e;}
  return res;
}
export const get=async(action,query={})=>(await api(action,{query})).json();
export const post=async(action,data={})=>(await api(action,{method:'POST',data})).json();
export const upload=async(action,query,raw)=>(await api(action,{method:'POST',query,raw})).json();
export function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('AR ბიბლიოთეკა ვერ ჩაიტვირთა'));document.head.append(s)})}
