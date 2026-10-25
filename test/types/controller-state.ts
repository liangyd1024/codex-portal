import {createControllerState} from '../../src/web/controller-state';
const state=createControllerState({desktopMode:false,selectedId:null,projectId:null,drafts:new Map<string,string>()});
state.selectedId='test-thread';state.busy.add('connect');state.selectionVersion++;
// A truthy string must not silently enable desktop mode during the TS migration.
// @ts-expect-error desktopMode is a boolean
state.desktopMode='false';
// @ts-expect-error request generations are numeric
state.selectionVersion='2';
// @ts-expect-error draft text is a string
state.drafts.set('test-thread',{text:'draft'});
// Native unknown fields require narrowing, rather than becoming implicit any.
state.detail={vendorField:{raw:'untouched'}};
// @ts-expect-error unknown payload fields cannot be consumed unchecked
state.detail.vendorField.raw.toUpperCase();
