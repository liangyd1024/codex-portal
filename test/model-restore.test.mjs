import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const modelSource=readFileSync(new URL('../src/web/services/model-selection.ts',import.meta.url),'utf8');
const modelOutput=ts.transpileModule(modelSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createModelSelection}=await import('data:text/javascript;base64,'+Buffer.from(modelOutput).toString('base64'));
const readerSource=readFileSync(new URL('../src/web/services/sidebar-reader.ts',import.meta.url),'utf8');
const readerOutput=ts.transpileModule(readerSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createSidebarReader}=await import('data:text/javascript;base64,'+Buffer.from(readerOutput).toString('base64'));



test('thread preferences survive history arriving before the model catalog',()=>{
 const state={models:[],model:'',effort:'',loadingModels:false};
 const selection=createModelSelection({state,effortNames:{},newChatOpen:()=>false,currentThread:()=>({model:'saved',reasoningEffort:'high'}),element:()=>({}),renderSelectOptions(){},renderControls(){}});
 selection.renderModels(true);
 assert.equal(state.model,'saved');assert.equal(state.effort,'high');
 state.models=[{id:'default',model:'default',isDefault:true,supportedReasoningEfforts:['low']},{id:'saved',model:'saved',supportedReasoningEfforts:['low','high']}];
 selection.renderModels();
 assert.equal(state.model,'saved');assert.equal(state.effort,'high');
 state.effort='low';selection.renderModels();assert.equal(state.effort,'low');
});


test('sidebar snapshot restores projects and chats without filtering to the selected project',async()=>{
 const source=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const snapshot={accountScope:'test',projects:[{id:'one'},{id:'two'}],data:[{id:'a',projectId:'one'},{id:'b',projectId:'two'}]};
 const state={selectedId:null,projectId:'one',projects:[],listVersion:0,threads:[],search:''},requests=[];
 const ctx=vm.createContext({state,threadSearch:'',createdThreads:new Map(),URLSearchParams,
  loadProjects:async()=>{state.projects=snapshot.projects;},connected:()=>true,usable:()=>true,$:()=>({scrollTop:0}),renderThreads(){},renderControls(){},
  requestAnimationFrame(){},loadVisibleThreads(){},loadSidebarActivity(){},
  api:async url=>{requests.push(url);return url.startsWith('/api/sidebar/activity?')?{accountScope:'test',data:[]}:snapshot;},recordError:e=>{throw e;},toast(){},messageOf:String});
 Object.assign(ctx,createSidebarReader({...ctx,element:ctx.$}));
 await ctx.readThreads();
 assert.equal(requests.length,2);
 const url=new URL(requests[0],'http://test');assert.equal(url.pathname,'/api/sidebar');
 assert.equal(url.searchParams.has('cwd'),false);assert.equal(url.searchParams.has('projectId'),false);
 assert.deepEqual(state.projects,snapshot.projects);assert.deepEqual(Array.from(state.threads,t=>t.id),['a','b']);
});

test('model aliases and mixed effort entries retain native fields and choose only advertised efforts',()=>{
 const native={id:'alias',model:'native-model',defaultReasoningEffort:'high',future:{keep:true},supportedReasoningEfforts:['custom',{reasoningEffort:'medium',description:'说明',future:true},{effort:'high'},{description:'无值不显示'}]};
 const state={models:[native],model:'alias',effort:'missing',loadingModels:false},options=[];
 const c=createModelSelection({state,effortNames:{medium:'中',high:'高'},newChatOpen:()=>false,currentThread:()=>null,element:id=>({id}),renderSelectOptions:(node,entries,value)=>options.push({node,entries,value}),renderControls(){}});
 assert.equal(c.modelFor('alias'),native);assert.equal(c.modelFor('native-model'),native);
 assert.deepEqual(c.effortsFor('alias'),[{value:'custom',label:'custom',description:''},{value:'medium',label:'中',description:'说明'},{value:'high',label:'高',description:''}]);
 c.renderModels();assert.equal(state.model,'native-model');assert.equal(state.effort,'high');assert.equal(options.at(-1).value,'high');assert.deepEqual(native.future,{keep:true});
 state.models=[{id:'replacement',supportedReasoningEfforts:[]}];c.renderModels();assert.equal(state.model,'replacement');assert.equal(state.effort,'');assert.deepEqual(options.at(-1).entries,[{value:'',label:'无可用档位'}]);
});

function runController(code,context){return vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);}
