import {createStore,useStore} from 'zustand';
import type {SelectOption} from '../../contracts/view';

const optionsStore=createStore<Record<string,SelectOption[]>>(()=>({
 'connection-select':[],
}));
export function publishSelectOptions(id:string,options:SelectOption[]) {optionsStore.setState({[id]:options});}
export function SelectOptions({id}:{id:'connection-select'}) {
 const options=useStore(optionsStore,state=>state[id]);
 return <>{options.map(option=><option key={option.value} value={option.value} title={option.title||undefined}>{option.label}</option>)}</>;
}
