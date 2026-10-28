import type {NativeTurn} from '../../contracts/native';
export interface ModeSelection {mode:'default'|'plan';modeExplicit?:boolean;modeTurnId?:string|null;modeKnown?:boolean}
// An explicit choice belongs to the next turn after this native turn.
export function selectComposerMode(selection:ModeSelection,mode:'default'|'plan',turns:NativeTurn[]) {
 selection.mode=mode;selection.modeExplicit=true;selection.modeTurnId=turns.at(-1)?.id??null;
}
export function reconcileComposerMode(selection:ModeSelection,turns:NativeTurn[]) {
 const latest=turns.at(-1),mode=latest?.collaborationMode?.mode;
 const known=mode==='plan'||mode==='default';
 const explicit=selection.modeExplicit&&selection.modeTurnId!==undefined;
 if(explicit&&(!known||selection.modeTurnId===(latest?.id??null)))return;
 selection.modeExplicit=false;
 selection.modeKnown=known;
 selection.mode=known?mode:'default';
}
export function composerModeOption(selection:ModeSelection) {
 return selection.modeExplicit||selection.modeKnown?selection.mode:undefined;
}
