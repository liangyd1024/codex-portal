import test from 'node:test';
import assert from 'node:assert/strict';
import {NewChatDraft} from '../public/new-chat.js';
const store=()=>({data:new Map(),getItem(k){return this.data.get(k);},setItem(k,v){this.data.set(k,v);}});
test('opening and saving a new draft does not create a thread and retains project',()=>{const storage=store(),d=new NewChatDraft(storage,'draft');d.cwd='/project';d.save();assert.equal(new NewChatDraft(storage,'draft').cwd,'/project');assert.equal(d.phase,'editing');});
test('reload during creation and network failure block duplicate creation',()=>{const storage=store(),d=new NewChatDraft(storage,'draft');d.begin();assert.equal(new NewChatDraft(storage,'draft').phase,'uncertain');assert.throws(()=>d.begin());d.failed(new TypeError('network'));assert.equal(d.phase,'uncertain');assert.throws(()=>d.begin());});
test('definite rejection permits retry, unknown engine outcome does not',()=>{const d=new NewChatDraft(store(),'draft');d.begin();d.failed({status:400});assert.equal(d.phase,'editing');d.begin();d.failed({status:504,code:'OUTCOME_UNKNOWN'});assert.equal(d.phase,'uncertain');});
test('successful creation makes the next new-chat draft available',()=>{const storage=store(),d=new NewChatDraft(storage,'draft');d.begin();d.complete();assert.equal(new NewChatDraft(storage,'draft').phase,'editing');});
