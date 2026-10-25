import type {Manager} from '../../../lib/manager.mjs';
import {browseFolders,createFolder,openFolderProject} from './project-folders';
import {readSidebar,readSidebarActivity,sidebarAction} from './sidebar';
import {composerCatalog} from '../../../lib/composer.mjs';

export function createWorkspaceService(manager:Manager) {
 return {
  composer:(cwd:string|null,kind:string|null)=>composerCatalog(manager,cwd,kind),
  sidebar:(options:Record<string,string>)=>readSidebar(manager,options),
  activity:(options:Record<string,string>)=>readSidebarActivity(manager,options),
  browse:(path:string|null)=>browseFolders(manager,path),
  createFolder:(data:Parameters<typeof createFolder>[1])=>createFolder(manager,data),
  openProject:(data:Parameters<typeof openFolderProject>[1])=>openFolderProject(manager,data),
  sidebarAction:(data:Parameters<typeof sidebarAction>[1])=>sidebarAction(manager,data),
 };
}
