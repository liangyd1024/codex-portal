import {createStore,useStore} from 'zustand';
import type {SelectOption} from '../../contracts/view';

const optionsStore=createStore<Record<string,SelectOption[]>>(()=>({
 'model-select':[{value:'',label:'等待模型目录'}],
 'effort-select':[{value:'',label:'思考档位'}],
}));
export function publishSelectOptions(id:string,options:SelectOption[]) {optionsStore.setState({[id]:options});}
export function SelectOptions({id}:{id:'model-select'|'effort-select'}) {
 const options=useStore(optionsStore,state=>state[id]);
 return <>{options.map(option=><option key={option.value} value={option.value} title={option.title||undefined}>{option.label}</option>)}</>;
}
