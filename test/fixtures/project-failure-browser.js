// Reject the first mutation of each kind; the base fixture never forwards APIs.
(() => {
 const f=window.rcmFixture,fetch=window.fetch;
 if(!f)throw Error('Project failure sample requires isolated fixture');
 const first=new Set(['/api/project-folders','/api/projects/open']);
 window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(options.method==='POST'&&first.delete(url.pathname)){
   f.fail={path:url.pathname,status:503,message:'模拟项目操作失败，请核对后重试。'};
  }
  return fetch(input,options);
 };
})();
