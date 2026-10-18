import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceCapture} from '../public/voice.js';
function fixture() {
  let draft='原草稿',context='a',recognizer;const statuses=[];
  class Recognition {
    constructor(){recognizer=this;}
    start(){}
    stop(){this.stopped=true;}
    abort(){this.aborted=true;}
  }
  const capture=new VoiceCapture({Recognition,read:()=>draft,write:value=>draft=value,context:()=>context,status:(...args)=>statuses.push(args)});
  return {capture,statuses,get rec(){return recognizer;},get draft(){return draft;},switchContext(){context='b';draft='另一个草稿';}};
}
const result=(text,isFinal)=>Object.assign([{transcript:text}],{isFinal});
test('dictation previews interim text then retains final text for manual sending',()=>{
  const f=fixture();f.capture.start();f.rec.onresult({results:[result('临时',false)]});assert.equal(f.draft,'原草稿\n临时');
  f.rec.onresult({results:[result('确认文字',true)]});f.capture.stop();assert.equal(f.rec.stopped,true);
  f.rec.onend();assert.equal(f.capture.active,null);assert.equal(f.draft,'原草稿\n确认文字');assert.match(f.statuses.at(-1)[0],/编辑后发送/);
});
test('cancel restores original draft and ignores late result and end events',()=>{
  const f=fixture();f.capture.start();f.rec.onresult({results:[result('新增',true)]});f.capture.interrupt(true);
  f.rec.onresult({results:[result('迟到',true)]});f.rec.onend();assert.equal(f.draft,'原草稿');assert.equal(f.rec.aborted,true);
});
test('context changes never overwrite another conversation draft',()=>{
  const f=fixture();f.capture.start();f.switchContext();f.rec.onresult({results:[result('旧录音',true)]});f.capture.interrupt(true);assert.equal(f.draft,'另一个草稿');
});
test('recognition errors release capture even when browser omits onend',()=>{
  const f=fixture();f.capture.start();f.rec.onresult({results:[result('已确认',true),result('未确认',false)]});
  f.rec.onerror({error:'network'});assert.equal(f.capture.active,null);assert.equal(f.draft,'原草稿\n已确认');assert.equal(f.rec.aborted,true);assert.match(f.statuses.at(-1)[0],/连接失败/);
  f.capture.start();assert.ok(f.capture.active);f.capture.interrupt();
});
test('duplicate starts and stops do not create a second recognition',()=>{
  const f=fixture();f.capture.start();const first=f.rec;f.capture.start();assert.equal(f.rec,first);f.capture.stop();f.capture.stop();assert.equal(f.capture.active.stopping,true);f.capture.interrupt();
});
test('recognition constructor failure leaves a usable draft and no active run',()=>{
  const capture=new VoiceCapture({Recognition:class {constructor(){throw Error('unavailable');}},read:()=>'',write:()=>{},context:()=>'',status:()=>{}});
  capture.start();assert.equal(capture.active,null);
});
