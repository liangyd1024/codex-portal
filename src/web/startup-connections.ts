import {createConnectionBootstrap,type ConnectionConfig} from './services/connection-bootstrap';

const bootstrap=createConnectionBootstrap({storage:()=>localStorage,reload:()=>location.reload(),fetch:(...args)=>fetch(...args),setTimeout,clearTimeout});
let initial:Promise<ConnectionConfig>|undefined;

// Entry and controller share one read for this document. A failed startup is
// retried by reloading the document, retaining the existing recovery contract.
export function readInitialConnections(){return initial??=bootstrap.readConnections();}
export const selectInitialTarget=bootstrap.selectTarget;
