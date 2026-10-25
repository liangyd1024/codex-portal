import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandoffController} from '../src/web/services/thread-handoff.ts';
function controlsFixture(){
 let calls=0,view,restored=0,focused;
 const controls=createHandoffController({endUse:()=>calls++,publish:value=>{view=value;},focus:banner=>{focused=banner;},restoreFocus:()=>restored++});
 const state={id:'a',context:'host:a:1',owned:true,connected:true,supported:true,running:true};
 controls.render(state);return {controls,state,view:()=>view,calls:()=>calls,restored:()=>restored,focused:()=>focused};
}
test('running handoff explains without sending or stacking; dismiss restores focus',()=>{
 const f=controlsFixture();
 f.controls.run();f.controls.run();assert.equal(f.calls(),0);assert.equal(f.view().bannerHidden,false);assert.match(f.view().message,/任务结束后/);
 f.controls.focus();assert.equal(f.focused(),true);
 f.controls.dismiss();assert.equal(f.view().bannerHidden,true);assert.equal(f.restored(),1);
 f.controls.run();f.controls.render({...f.state,running:false});assert.equal(f.view().bannerHidden,true);f.controls.run();assert.equal(f.calls(),1);
});
test('errors expose retry and disappear across selection context changes',()=>{
 const f=controlsFixture();f.controls.render({...f.state,running:false});
 f.controls.showError('交还结果未确认');assert.equal(f.view().bannerHidden,false);assert.equal(f.view().retryHidden,false);assert.equal(f.view().retryDisabled,false);
 f.controls.render({...f.state,context:'host:b:2',id:'b'});assert.equal(f.view().bannerHidden,true);
});
test('takeover conflict never creates a permanent handoff warning',()=>{
 const f=controlsFixture();
 f.controls.render({...f.state,owned:false,running:false,conflict:true});assert.equal(f.view().bannerHidden,true);assert.equal(f.view().message,'');
 f.controls.render({...f.state,owned:false,running:false,conflict:true,handoff:{state:'waiting'}});assert.equal(f.view().bannerHidden,false);assert.match(f.view().message,/等待引擎释放/);
});
