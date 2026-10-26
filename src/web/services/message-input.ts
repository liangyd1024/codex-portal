interface EnterState {touch: boolean; composing: boolean; compositionEnded: number}
interface Dependencies {
  input: () => HTMLTextAreaElement;
  id: () => string | null;
  suspended: () => boolean;
  persist: (id: string, value: string) => void;
  render: () => void;
  send: (event?: Event, alternate?: boolean) => unknown;
  canSend: () => boolean;
  steerQueued?: () => unknown;
  touch: () => boolean;
  shouldSend: (event: KeyboardEvent, state: EnterState) => boolean;
  now: () => number;
  style: (input: HTMLTextAreaElement) => Pick<CSSStyleDeclaration, 'font' | 'lineHeight'>;
}
export function createMessageInput(d: Dependencies) {
  let sizeKey: string | undefined;
  function resize() {
    const input = d.input();
    if (!input.clientWidth) return;
    const key = JSON.stringify([input.value, input.placeholder, input.clientWidth, d.style(input).font, d.style(input).lineHeight]);
    if (sizeKey === key) return;
    sizeKey = key;
    input.style.height = '0px';
    const height = Math.max(34, input.scrollHeight);
    input.style.height = Math.min(160, height) + 'px';
    input.style.overflowY = height > 160 ? 'auto' : 'hidden';
  }
  // Bind at the existing installation point, after attachment/reference listeners.
  function bind(form: HTMLFormElement) {
    const input = d.input();
    form.onsubmit = d.send;
    input.oninput = () => {
      if (d.id() && !d.suspended()) d.persist(d.id()!, input.value);
      resize();
      d.render();
    };
    let composing = false, compositionEnded = -Infinity;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; compositionEnded = d.now(); });
    input.onkeydown = event => {
      if (d.shouldSend(event, {touch: d.touch(), composing, compositionEnded})) {
        event.preventDefault();
        if (event.repeat || event.altKey || input.disabled) return;
        const alternate = event.metaKey || event.ctrlKey;
        if (alternate && !input.value.trim()) d.steerQueued?.();
        else if (d.canSend()) d.send(undefined, alternate);
      }
    };
  }
  return {resize, bind};
}
