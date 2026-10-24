import {configureGoalToolbar} from '../../public/goal-toolbar.js';
import {installReactGoalToolbar} from './components/GoalToolbar';
import { hydrateRoot } from 'react-dom/client';
import { useLayoutEffect } from 'react';
import { WorkspaceShell } from './components/Shell';
let mounted!: () => void;
let hydrationFailure: unknown;
const ready = new Promise<void>((resolve,reject) => {
  mounted = () => queueMicrotask(() => hydrationFailure ? reject(hydrationFailure) : resolve());
});
function Application() {
  useLayoutEffect(() => { mounted(); }, []);
  return <WorkspaceShell/>;
}
const shell=document.getElementById('app-shell');
if(!shell)throw new Error('工作台结构缺失。');
hydrateRoot(shell,<Application/>,{onRecoverableError(error){hydrationFailure=error;console.error('工作台结构不一致',error);}});
await ready;
configureGoalToolbar(installReactGoalToolbar);
// Commands remain event-driven; mounting components never sends native commands.
await import('../../public/app.js');
