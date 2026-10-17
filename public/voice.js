// One recognition instance per capture. Late events cannot change another draft.
export class VoiceCapture {
 constructor({Recognition,read,write,context,canSend,send,status}){Object.assign(this,{Recognition,read,write,context,canSend,send,status});this.active=null;}
 start(auto=false){if(this.active)return;const rec=new this.Recognition();const run={rec,base:this.read(),context:this.context(),auto,manual:false,failed:false,finals:new Map(),done:false};this.active=run;rec.lang='zh-CN';rec.continuous=true;rec.interimResults=true;
  const current=()=>this.active===run&&!run.done;
  const update=()=>{const text=[...run.finals.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join('');if(this.context()===run.context)this.write(run.base+(run.base&&text?'\n':'')+text);};
  rec.onresult=e=>{if(!current())return;let interim='';for(let i=0;i<e.results.length;i++){if(e.results[i].isFinal)run.finals.set(i,e.results[i][0].transcript);else interim+=e.results[i][0].transcript;}update();this.status((run.manual?'正在处理':'正在听取')+(interim?'：'+interim:''),true);};
  rec.onerror=e=>{if(!current())return;run.failed=true;this.status(({ 'not-allowed':'麦克风权限被拒绝。请在浏览器设置中允许使用麦克风。','audio-capture':'无法使用麦克风。','network':'语音服务连接失败。已保留文字，请手动发送。','no-speech':'没有识别到语音。'})[e.error]||'语音识别已停止。已保留文字，请手动发送。',true);};
  rec.onend=()=>{if(!current())return;run.done=true;clearTimeout(run.timer);update();this.active=null;if(!run.failed)this.status(run.finals.size?'识别完成。':'没有识别到语音。',false);else this.status(null,false);if(run.manual&&run.auto&&!run.failed&&[...run.finals.values()].some(text=>text.trim())&&this.context()===run.context&&this.canSend())this.send();};
  this.status('正在听取…',true);try{rec.start();}catch{run.failed=true;this.active=null;this.status('无法开始语音识别。请使用手机键盘听写。',false);}
 }
 stop(){const run=this.active;if(!run||run.manual)return;run.manual=true;this.status('正在处理…',true);try{run.rec.stop();}catch{this.interrupt();}run.timer=setTimeout(()=>this.interrupt(),10000);}
 interrupt(cancel=false){const run=this.active;if(!run)return;run.done=true;run.manual=false;clearTimeout(run.timer);this.active=null;if(cancel&&this.context()===run.context)this.write(run.base);try{run.rec.abort();}catch{}this.status(cancel?'已取消。':'识别已停止，已保留文字。',false);}
}
export function installVoice({input,context,send,render}){
 const button=document.getElementById('voice-toggle'),cancel=document.getElementById('voice-cancel'),mode=document.getElementById('voice-mode'),label=document.getElementById('voice-status');
 try{mode.value=localStorage.getItem('rcm.voice.mode')||'confirm';}catch{}
 mode.onchange=()=>{try{localStorage.setItem('rcm.voice.mode',mode.value);}catch{}};
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition||!window.isSecureContext){button.disabled=true;label.textContent='此浏览器或连接不支持网页语音，请使用手机键盘听写。';return {interrupt(){}};}
 const capture=new VoiceCapture({Recognition,read:()=>input.value,write:value=>{input.value=value;input.dispatchEvent(new Event('input'));},context,canSend:()=>!document.getElementById('send-message').disabled,send,status:(text,active)=>{if(text!==null)label.textContent=text;button.textContent=active?'结束语音':'语音';button.setAttribute('aria-pressed',String(active));cancel.hidden=!active;mode.disabled=active;input.readOnly=active;render();}});
 button.onclick=()=>{if(capture.active)capture.stop();else if(!input.disabled)capture.start(mode.value==='auto');else label.textContent='请先接管会话，再开始语音输入。';};
 cancel.onclick=()=>capture.interrupt(true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)capture.interrupt();});
 window.addEventListener('pagehide',()=>capture.interrupt());window.addEventListener('offline',()=>capture.interrupt());
 return capture;
}
