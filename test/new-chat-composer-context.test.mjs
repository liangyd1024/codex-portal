import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Exercise the controller's actual composer binding with an existing desktop thread.
const source=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');
const binding=source.match(/composer=installComposer\(\{[^\n]+context:(\(\)=>\(\{[^\n]+?\}\)),refresh:/)?.[1];
assert.ok(binding,'composer context binding exists');
function context(newChatOpen){return runInNewContext('('+binding+')()',{
 newChatOpen,state:{desktopMode:true,busy:new Set(),detail:{desktop:{planSupported:false},goal:{objective:'原目标'}}},
 inputId:()=>newChatOpen?'draft':'desktop-thread',newDraft:{cwd:'/new-project'},currentThread:()=>({cwd:'/old-project'}),inputReady:()=>true,running:()=>true,turns:()=>[{id:"existing",collaborationMode:{mode:"plan"}}]
});}
test('new draft opened from a desktop thread has web goal and plan capabilities',()=>{const c=context(true);assert.equal(c.desktop,false);assert.equal(c.draft,true);assert.equal(c.active,false);assert.equal(c.goal,null);assert.equal(c.cwd,'/new-project');assert.equal(c.turns.length,0);});
test('returning to the desktop thread preserves its real capability restrictions',()=>{const c=context(false);assert.equal(c.desktop,true);assert.equal(c.planSupported,false);assert.equal(c.active,true);assert.equal(c.goal.objective,'原目标');});
