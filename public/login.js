const form = document.getElementById('pair-form'), input = document.getElementById('pair-code');
const button = form.querySelector('button'), status = document.getElementById('pair-status');
const normalize = text => text.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/\s/g,'');
let pending = false;
input.addEventListener('paste',event => {
  const code = normalize(event.clipboardData?.getData('text') || '');
  if (/^\d{6}$/.test(code)) { event.preventDefault(); input.value = code; }
});
input.addEventListener('input',() => { input.value = normalize(input.value); input.setCustomValidity(''); });
form.onsubmit = async event => {
  event.preventDefault(); if (pending) return;
  const code = normalize(input.value);
  if (!/^\d{6}$/.test(code)) { input.setCustomValidity('请输入六位数字配对码。'); input.reportValidity(); return; }
  pending = true; button.disabled = true; button.textContent = '正在配对…';
  form.setAttribute('aria-busy','true'); status.textContent = '正在连接工作台…';
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
  try {
    const response = await fetch('/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || '配对失败，请重新生成配对码后重试。');
    status.textContent = '配对成功，正在进入…'; location.reload();
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '连接超时，请检查网络后重试。' : error instanceof TypeError ? '无法连接工作台，请检查手机网络与 Mac 服务后重试。' : error.message;
    button.textContent = '重试配对'; input.focus({preventScroll:true});
  } finally { clearTimeout(timer); pending = false; button.disabled = false; form.setAttribute('aria-busy','false'); }
};
