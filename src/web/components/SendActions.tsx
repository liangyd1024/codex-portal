import {createStore, useStore} from 'zustand';
import {flushSync} from 'react-dom';
interface View {
  send: {disabled: boolean; label: string; title?: string};
  guide: {hidden: boolean; disabled: boolean};
  stop: {hidden: boolean; disabled: boolean; text: string; title: string; label?: string; busy?: string};
}
interface Actions {guide: () => unknown; stop: () => unknown}
const store = createStore<{view: View; actions: Actions | null}>(() => ({
  view: {
    send: {disabled: true, label: '发送消息'},
    guide: {hidden: true, disabled: false},
    stop: {hidden: true, disabled: false, text: '停止', title: '停止当前轮次'},
  }, actions: null,
}));
export function publishSendActions(view: View) {
  const old = store.getState().view;
  if ((['send', 'guide', 'stop'] as const).every(key => JSON.stringify(old[key]) === JSON.stringify(view[key]))) return;
  flushSync(() => store.setState({view}));
}
export function installSendActions(actions: Actions) { flushSync(() => store.setState({actions})); }
export function SendActions() {
  const {view, actions} = useStore(store);
  return <div className="send-actions">
    {actions && <button className="text-button" id="guide-message" type="button" title="引导当前任务（⌘/Ctrl+Enter）" hidden={view.guide.hidden} disabled={view.guide.disabled} onClick={() => actions.guide()}>引导</button>}
    <button className="stop-button" id="interrupt" type="button" title={view.stop.title} hidden={view.stop.hidden} disabled={view.stop.disabled}
      aria-label={view.stop.label} aria-busy={view.stop.busy as 'true' | 'false' | undefined} onClick={() => actions?.stop()}><svg className="icon"><use href="#i-stop"/></svg><span>{view.stop.text}</span></button>
    <button type="submit" id="send-message" className="send-button" disabled={view.send.disabled} aria-label={view.send.label} title={view.send.title}><svg className="icon"><use href="#i-arrow"/></svg></button>
  </div>;
}
