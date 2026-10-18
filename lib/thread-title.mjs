// Deterministic, extractive titles: no model, network, or project-file reads.
export function summarizeTitle(text, {hasImages=false}={}) {
  const cleaned=String(text??'').slice(0,20000)
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g,' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/<[^>\n]+>/g,' ')
    .replace(/^[\t ]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm,'')
    .replace(/[*`~]/g,'').trim();
  const sentences=cleaned.split(/[\n。！？!?]+/).map(s=>s.trim()).filter(Boolean);
  if(!sentences.length)return hasImages?'图片会话':'新会话';
  const intent=/修复|排查|增加|新增|添加|实现|修改|优化|分析|对比|比较|检查|整理|绘制|生成|支持|如何|为什么|怎么|不能|不要|不需要|失败|报错|\b(?:fix|add|debug|update|implement|analyze)\b/i;
  // Prefer an actionable sentence, retaining its wording rather than guessing.
  let title=(sentences.find(s=>intent.test(s))||sentences[0])
    .replace(/^(?:(?:你好|您好|麻烦你?|劳驾|请问|请你?|帮我|帮忙|能否|可以)(?:[，,\s]*)|能不能帮我)+/u,'')
    .replace(/(排查|检查|分析|整理|看)(?:一下|下)(?=[，,\s]|$)/g,'$1')
    .replace(/^(排查|检查|分析|整理)[，,]\s*/,'$1')
    .replace(/(?:[，,\s]*(?:谢谢|感谢|可以吗|好吗|给我))+$/u,'')
    .replace(/\s+/g,' ').replace(/^[，,:：\s]+|[，,:：;；.\s]+$/g,'').trim();
  if(!title)title=sentences[0];
  const chars=Array.from(title);
  if(chars.length<=36)return title;
  const prefix=chars.slice(0,35).join('');
  // Prefer a nearby phrase boundary and never split a surrogate pair.
  const boundary=Math.max(prefix.lastIndexOf('，'),prefix.lastIndexOf(','),prefix.lastIndexOf(' '));
  return (boundary>=20?prefix.slice(0,boundary):prefix).trimEnd()+'…';
}
