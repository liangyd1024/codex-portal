let renderer;
export function configureQuestionForms(value){renderer=value;}
export function questionForm(request,options){if(!renderer)throw Error('问题表单尚未初始化。');return renderer.create(request,options);}
export function releaseQuestionForms(){renderer?.release();}
export function restoreQuestionForm(form,fields){renderer?.restore(form,fields);}
export function syncQuestionForms(state){renderer?.sync(state);}
