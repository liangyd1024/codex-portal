// Runs in an opaque-origin sandbox. No API, network, navigation or parent DOM access.
const config = {startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,
  maxTextSize:30000,maxEdges:300,theme:'neutral',htmlLabels:false,
  fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  flowchart:{htmlLabels:false},
  secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','htmlLabels','flowchart','fontFamily']};
let busy=false;
window.addEventListener('message',async event=>{
  if(event.source!==parent || event.data?.type!=='rcm-mermaid-render' || busy)return;
  const {id,source}=event.data;
  if(!Number.isSafeInteger(id)||typeof source!=='string'||source.length>30000)return;
  busy=true;
  try {
    mermaid.initialize(config);
    const {svg}=await mermaid.render('diagram-'+id,source);
    // SVG is returned as an inert image, never inserted in the workbench DOM.
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;
    const box=root.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
    if(box?.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0){root.setAttribute('width',String(box[2]));root.setAttribute('height',String(box[3]));}
    parent.postMessage({type:'rcm-mermaid-result',id,svg:new XMLSerializer().serializeToString(root)},'*');
  } catch {
    parent.postMessage({type:'rcm-mermaid-result',id,error:true},'*');
  } finally {document.body.replaceChildren();busy=false;}
});
parent.postMessage({type:'rcm-mermaid-ready'},'*');
