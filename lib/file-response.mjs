import {pipeline} from 'node:stream/promises';

export async function fileResponse(manager,req,res,threadId,itemId,url) {
  const mode=url.searchParams.get('mode')||'content';
  if(!['meta','content','text','download','html'].includes(mode))throw Object.assign(new Error('文件操作无效。'),{status:400});
  const controller=new AbortController();
  const abort=()=>controller.abort();res.once('close',abort);
  let transfer;
  try {
    transfer=await manager.openFile(threadId,itemId,{reference:url.searchParams.get('reference'),mode,range:req.headers.range,ifRange:req.headers['if-range'],head:req.method==='HEAD'},{signal:controller.signal});
    if(res.destroyed){transfer.cancel();return;}
    const {meta,body}=transfer;
    if(meta.error){
      transfer.cancel();body.destroy();
      if(meta.status===416)res.setHeader('Content-Range',`bytes */${meta.size}`);
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.writeHead(meta.status||502);
      res.end(req.method==='HEAD'?undefined:JSON.stringify({error:{message:meta.error,retryable:meta.retryable??(meta.status>=500)}}));return;
    }
    if(!Number.isSafeInteger(meta.size)||meta.size<0||!Number.isSafeInteger(meta.length)||meta.length<0)throw new Error('文件响应无效。');
    res.setHeader('Cache-Control','no-store');
    if(mode==='meta'){
      body.resume();res.setHeader('Content-Type','application/json; charset=utf-8');res.end(req.method==='HEAD'?undefined:JSON.stringify(meta));return;
    }
    const html=mode==='html';
    if(html&&(!meta.htmlPreview||meta.mime!=='text/html; charset=utf-8'||meta.status!==200))throw Object.assign(new Error('HTML 预览响应无效。'),{status:502});
    const download=mode==='download'||meta.kind==='download';
    res.setHeader('Content-Type',download?'application/octet-stream':meta.mime);
    res.setHeader('Content-Disposition',`${download?'attachment':'inline'}; filename="file"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`);
    // Only this explicit HTML mode can execute inline scripts. Its opaque origin
    // cannot access the workbench, cookies or storage; no network or form access.
    // Never grant allow-same-origin or weaken the application's own CSP.
    res.setHeader('Content-Security-Policy',html
      ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors 'none'"
      : "default-src 'none'; sandbox; frame-ancestors 'self'");
    if(html){res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Opener-Policy','same-origin');}
    res.setHeader('Content-Length',meta.length);
    if(mode!=='text'&&!html){
      res.setHeader('Accept-Ranges','bytes');res.setHeader('ETag',meta.etag);
      if(meta.status===206)res.setHeader('Content-Range',`bytes ${meta.start}-${meta.end}/${meta.size}`);
    }
    res.writeHead(meta.status);
    if(req.method==='HEAD'){body.resume();res.end();return;}
    await pipeline(body,res);
  } finally {
    res.off('close',abort);transfer?.cancel();
  }
}
