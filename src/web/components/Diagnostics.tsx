import { useStore } from 'zustand';
import { workspaceStore } from '../state';
export function Diagnostics() {
  const view = useStore(workspaceStore, state => state.diagnostics);
  const ready = useStore(workspaceStore, state => state.diagnosticsReady);
  if (!ready) return <p className="subtle">连接记录将在这里显示。</p>;
  return <>{view.selectedId && <p className="session-id">会话 ID · {view.selectedId}</p>}
    {view.entries.map((entry,index) => <div className={'diagnostic-entry'+(entry.error?' error':'')} key={index}>
      <time>{entry.title}</time>{entry.messages.map((message,i)=><p key={i}>{message}</p>)}
    </div>)}
    {!view.selectedId && !view.entries.length && <p className="subtle">暂无错误记录。连接后显示服务状态。</p>}
  </>;
}
