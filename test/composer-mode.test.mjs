import test from 'node:test';
import assert from 'node:assert/strict';
import {selectComposerMode,reconcileComposerMode,composerModeOption} from '../src/web/services/composer-mode.ts';
const turn=(id,mode)=>({id,items:[],...(mode?{collaborationMode:{mode}}:{})});
test('a fresh browser restores native plan mode and follows later default turns',()=>{
 const selection={mode:'default'};
 reconcileComposerMode(selection,[turn('a','plan')]);
 assert.equal(composerModeOption(selection),'plan');
 reconcileComposerMode(selection,[turn('a','plan'),turn('b','default')]);
 assert.equal(composerModeOption(selection),'default');
});
test('an explicit next-turn choice survives reload and repeated old history until native confirmation',()=>{
 let selection={mode:'default'};const turns=[turn('a','plan')];
 reconcileComposerMode(selection,turns);selectComposerMode(selection,'default',turns);
 selection=JSON.parse(JSON.stringify(selection));
 for(let i=0;i<3;i++){reconcileComposerMode(selection,turns);assert.equal(composerModeOption(selection),'default');}
 reconcileComposerMode(selection,[...turns,turn('b')]);assert.equal(composerModeOption(selection),'default');
 reconcileComposerMode(selection,[...turns,turn('b','plan')]);assert.equal(composerModeOption(selection),'plan');assert.equal(selection.modeExplicit,false);
});
test('unknown latest mode never uses an older plan or sends a default override',()=>{
 const selection={mode:'plan',modeExplicit:true};
 reconcileComposerMode(selection,[turn('a','plan'),turn('b')]);
 assert.equal(composerModeOption(selection),undefined);
 reconcileComposerMode(selection,[turn('b','default')]);assert.equal(composerModeOption(selection),'default');
});
test('new drafts allow explicit plan selection and separate conversations stay independent',()=>{
 const first={mode:'default'},second={mode:'default'};
 selectComposerMode(first,'plan',[]);reconcileComposerMode(first,[]);
 reconcileComposerMode(second,[turn('other','default')]);
 assert.equal(composerModeOption(first),'plan');assert.equal(composerModeOption(second),'default');
 reconcileComposerMode(first,[turn('new','plan')]);assert.equal(first.modeExplicit,false);
});
