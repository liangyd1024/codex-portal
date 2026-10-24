// Delay one exact search response before the application captures fetch.
(() => {
 const f=window.rcmFixture,fetchFixture=window.fetch;
 let release;
 window.fetch=async(url,options)=>{
  const response=await fetchFixture(url,options),u=new URL(typeof url==='string'?url:url.url,location.href);
  if(u.pathname==='/api/sidebar'&&u.searchParams.get('search')==='长标题'){
   f.searchPending=true;
   return new Promise(resolve=>{release=()=>{f.searchPending=false;resolve(response);};});
  }
  return response;
 };
 addEventListener('DOMContentLoaded',()=>{
  const button=document.createElement('button');button.textContent='释放旧搜索响应';
  button.style.cssText='position:fixed;right:4px;bottom:4px;z-index:100000;min-height:44px';
  button.onclick=()=>release?.();document.body.append(button);
 });
})();
