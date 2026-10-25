// Keep browser layout bounded while retaining the full transcript in memory.
export const OUTPUT_WINDOW_SIZE = 65536;
/** @param {string} text @param {number|'tail'} [position] */
export function outputWindow(text, position = 'tail', size = OUTPUT_WINDOW_SIZE) {
  const total = text.length;
  let start = position === 'tail' ? Math.max(0,total-size) : Math.max(0,Math.min(Number(position)||0,Math.max(0,total-size)));
  if(start>0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  let end=Math.min(total,start+size);
  if(end<total && /[\uDC00-\uDFFF]/.test(text[end])) end++;
  return {start,end,total,text:text.slice(start,end),following:position==='tail'};
}
