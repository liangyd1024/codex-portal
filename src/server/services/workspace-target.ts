import type {Manager} from '../../../lib/manager.mjs';
/** Additional RCM workspace metadata carried by the native manager. */
export type WorkspaceTarget=Manager & {
 host:Manager['host'] & {home?:string;alias?:string;name?:string;label?:string};
 service:Manager['service'] & {protocolValidation?:{policy?:number;unsupportedMethods?:string[];features?:Record<string,{supported?:boolean}>}};
 projectFolderMutation?:boolean;sidebarMutation?:boolean;
};
