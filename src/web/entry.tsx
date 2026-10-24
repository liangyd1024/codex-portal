import {installReactComposerDialog} from './components/ComposerDialog';
import {installReactComposerControls} from './components/ComposerControls';
import {installReactComposerCatalog} from './components/ComposerCatalog';
import {configurePlanCompletion,configureComposerCatalog,configureComposerControls,configureComposerDialog} from '../../public/composer.js';
import {installReactPlanCompletion} from './components/PlanCompletion';
import {installReactGoalEditor} from './components/GoalEditor';
import {configureGoalToolbar,configureGoalEditor} from '../../public/goal-toolbar.js';
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
configureGoalEditor(installReactGoalEditor);
configurePlanCompletion(installReactPlanCompletion);
configureComposerCatalog(installReactComposerCatalog);
configureComposerControls(installReactComposerControls);
configureComposerDialog(installReactComposerDialog);
// Commands remain event-driven; mounting components never sends native commands.
await import('../../public/app.js');
