// One recognition instance per capture. Late events cannot change another draft.
// Dictation only edits the draft; sending always requires an explicit action.
export class VoiceCapture {
  constructor({Recognition, read, write, context, status}) {
    Object.assign(this, {Recognition, read, write, context, status});
    this.active = null;
  }
  start() {
    if (this.active) return;
    const run = {base:this.read(), context:this.context(), finals:new Map(), done:false, stopping:false};
    this.active = run;
    const current = () => this.active === run && !run.done;
    const update = (interim = '') => {
      const text = [...run.finals.entries()].sort((a,b) => a[0]-b[0]).map(x => x[1]).join('') + interim;
      if (this.context() === run.context) this.write(run.base + (run.base && text ? '\n' : '') + text);
    };
    const finish = message => {
      if (!current()) return;
      run.done = true; clearTimeout(run.timer); update(); this.active = null;
      this.status(message, false);
    };
    try {
      const rec = run.rec = new this.Recognition();
      rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
      rec.onstart = () => { if (current() && !run.stopping) this.status('正在听写… 点击 ✓ 完成，Esc 取消', true); };
      rec.onresult = event => {
        if (!current()) return;
        let interim = '';
        for (let i=0; i<event.results.length; i++) {
          if (event.results[i].isFinal) run.finals.set(i,event.results[i][0].transcript);
          else interim += event.results[i][0].transcript;
        }
        update(interim);
      };
      rec.onerror = event => {
        if (!current()) return;
        finish(({'not-allowed':'麦克风权限被拒绝，请在浏览器设置中允许麦克风。',
          'service-not-allowed':'浏览器不允许使用语音服务，请使用键盘输入。',
          'audio-capture':'无法使用麦克风，请检查设备后重试。',
          'network':'语音服务连接失败，已保留确认的文字，可编辑后发送。',
          'no-speech':'没有听到声音，请重试。'})[event.error] || '听写中断，已保留确认的文字。');
        try { rec.abort(); } catch {}
      };
      rec.onend = () => finish(run.finals.size ? '听写完成，可编辑后发送。' : '没有识别到文字，请重试。');
      this.status('正在启动麦克风，请允许浏览器使用麦克风…',true);
      rec.start();
    } catch {
      finish('无法开始听写，请重试或使用键盘输入。');
    }
  }
  stop() {
    const run = this.active;
    if (!run || run.stopping) return;
    run.stopping = true;
    this.status('正在完成转写…',true);
    run.timer = setTimeout(() => this.interrupt(),10000);
    try { run.rec.stop(); } catch { this.interrupt(); }
  }
  interrupt(cancel = false) {
    const run = this.active;
    if (!run) return;
    run.done = true; clearTimeout(run.timer); this.active = null;
    if (this.context() === run.context) {
      const text = [...run.finals.entries()].sort((a,b) => a[0]-b[0]).map(x=>x[1]).join('');
      this.write(cancel ? run.base : run.base + (run.base && text ? '\n' : '') + text);
    }
    try { run.rec?.abort(); } catch {}
    this.status(cancel ? '已取消听写，原草稿已恢复。' : '听写已停止，已保留确认的文字。',false);
  }
}

export function installVoice({input, context, render}) {
  const button=document.getElementById('voice-toggle'), cancel=document.getElementById('voice-cancel');
  const label=document.getElementById('voice-status'), feedback=document.getElementById('voice-feedback');
  const form=input.form, dismiss=document.getElementById('voice-dismiss');
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported=Boolean(Recognition && window.isSecureContext);
  let capture, focusAfterStop=false;
  const sync = () => {
    if (input.disabled && capture?.active) capture.interrupt();
    button.disabled = !supported || input.disabled || Boolean(capture?.active?.stopping);
    if (!supported) button.title='此浏览器不支持网页听写，可使用系统或手机键盘听写。';
    else if (input.disabled) button.title='连接并接管会话后可使用语音输入。';
    else if (!capture?.active) button.title='语音输入：转写后可编辑，再手动发送。语音可能使用浏览器厂商的云服务。';
  };
  capture=new VoiceCapture({Recognition,read:()=>input.value,write:value=>{
    input.value=value;input.dispatchEvent(new Event('input'));
  },context,status:(text,active)=>{
    label.textContent=text;feedback.hidden=false;dismiss.hidden=active;
    button.querySelector('use').setAttribute('href',active ? '#i-check' : '#i-mic');
    button.setAttribute('aria-label',active ? '完成听写' : '语音输入');
    button.setAttribute('aria-pressed',String(active));
    button.title=active ? '完成听写，保留文字供确认' : button.title;
    cancel.hidden=!active;input.readOnly=active;
    form.classList.toggle('is-recording',active);
    render();sync();
    if (!active && focusAfterStop) { focusAfterStop=false; if (!input.disabled) focusInput(); }
  }});
  capture.sync=sync;
  const focusInput=()=>{input.focus();input.setSelectionRange(input.value.length,input.value.length);};
  button.onclick=()=>{if(capture.active){focusAfterStop=true;capture.stop();}else if(!button.disabled)capture.start();};
  cancel.onclick=()=>{capture.interrupt(true);focusInput();};
  dismiss.onclick=()=>{feedback.hidden=true;focusInput();};
  form.addEventListener('keydown',event=>{
    if (event.key==='Escape' && capture.active) {event.preventDefault();capture.interrupt(true);focusInput();}
  });
  input.addEventListener('input',()=>{if(!capture.active)feedback.hidden=true;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)capture.interrupt();});
  window.addEventListener('pagehide',()=>capture.interrupt());
  window.addEventListener('offline',()=>capture.interrupt());
  sync();return capture;
}
