import {installProjectFolders} from '../src/web/components/ProjectFolders';
export {installProjectFolders};
import {publishProjectPicker,installProjectPickerActions} from '../src/web/components/ProjectPicker';
let folderBrowser;
publishProjectPicker({active:true});
export function configureProjectBrowser(options){folderBrowser=installProjectFolders(options);installProjectPickerActions({browse:anchor=>folderBrowser?.open(anchor)});return folderBrowser;}
