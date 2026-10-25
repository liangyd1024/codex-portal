import {controllerElement,el} from '../../src/web/controller-dom';
controllerElement('message-input').setSelectionRange(0,0);
controllerElement('model-select').selectedIndex=0;
controllerElement('send-message').disabled=true;
// @ts-expect-error a structural container is not an input
controllerElement('app-shell').value='draft';
// @ts-expect-error buttons do not expose text selections
controllerElement('send-message').selectionStart=0;
const dynamicId:string='reason-'+Date.now();
// @ts-expect-error generated feedback may not have been inserted yet
controllerElement(dynamicId).hidden=true;
el('textarea').value='draft';
// @ts-expect-error typed builders retain the requested tag
el('div').value='draft';
