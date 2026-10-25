export interface Model {hidden?:unknown;id:string;model?:string;displayName?:string;description?:string;isDefault?:boolean;defaultReasoningEffort?:string;supportedReasoningEfforts?:(string|{reasoningEffort?:string;effort?:string;description?:string;[field:string]:unknown})[];[field:string]:unknown}
interface EffortOption {value:string;label:string;description:string}
interface Dependencies {state:{models:Model[];model:string;effort:string;loadingModels:boolean};effortNames:Record<string,string>;newChatOpen:()=>boolean;currentThread:()=>{model?:string;reasoningEffort?:string}|null|undefined;element:(id:'model-select'|'effort-select')=>HTMLSelectElement;renderSelectOptions:(select:HTMLSelectElement,options:{value:string;label:string;title?:string}[],value:string)=>void;renderControls:()=>void}
export function createModelSelection({state,effortNames,newChatOpen,currentThread,element:$,renderSelectOptions,renderControls}:Dependencies){
function modelId(m:Model) { return m.model || m.id; }
function modelFor(id:string) { return state.models.find(m => modelId(m) === id || m.id === id); }
function effortsFor(id:string):EffortOption[] {
  const m = modelFor(id); return (m?.supportedReasoningEfforts || []).map(e => typeof e === 'string' ? {value:e,label:effortNames[e] || e,description:''} : {value:e.reasoningEffort || e.effort,label:effortNames[(e.reasoningEffort || e.effort)!] || e.reasoningEffort || e.effort,description:e.description || ''}).filter(e => e.value) as EffortOption[];
}
function defaultEffort(id:string) { const m = modelFor(id), opts = effortsFor(id); return opts.some(e => e.value === m?.defaultReasoningEffort) ? m!.defaultReasoningEffort! : opts[0]?.value || ''; }
function fillModels(select:HTMLSelectElement,selected:string) {
  const options=state.models.length?state.models.map(m=>({value:modelId(m),label:m.displayName||modelId(m),title:m.description||''})):[{value:'',label:state.loadingModels?'正在读取模型…':'等待模型目录'}];
  const value=state.models.some(m=>modelId(m)===selected)?selected:state.models.length?modelId(state.models.find(m=>m.isDefault)||state.models[0]):'';
  renderSelectOptions(select,options,value);
}
function fillEfforts(select:HTMLSelectElement,model:string,effort:string) {
  const opts=effortsFor(model);
  renderSelectOptions(select,opts.length?opts.map(e=>({value:e.value,label:e.label,title:e.description})):[{value:'',label:'无可用档位'}],opts.some(e=>e.value===effort)?effort:defaultEffort(model));
}
function renderModels(preferThread = false) {
  const t = currentThread();
  if (preferThread && !newChatOpen() && t?.model) state.model = modelFor(t.model) ? modelId(modelFor(t.model)!) : t.model;
  if (preferThread && !newChatOpen() && t?.reasoningEffort) state.effort = t.reasoningEffort;
  // Preserve restored preferences until the model catalog arrives.
  if (!state.models.length) {
    fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
    renderControls(); return;
  }
  state.model = modelId(modelFor(state.model) || state.models.find(m => m.isDefault) || state.models[0]);
  if (preferThread && !newChatOpen() && t?.reasoningEffort) state.effort = t.reasoningEffort;
  if (!effortsFor(state.model).some(e => e.value === state.effort)) state.effort = defaultEffort(state.model);
  fillModels($('model-select'),state.model); fillEfforts($('effort-select'),state.model,state.effort);
  renderControls();
}

 return {modelId,modelFor,effortsFor,defaultEffort,fillModels,fillEfforts,renderModels};
}
