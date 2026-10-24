import {useLayoutEffect, useRef} from 'react';
import {createStore, useStore} from 'zustand';
import {flushSync} from 'react-dom';
import type {SelectOption} from '../../contracts/view';
export type ModelSelectId = 'model-select' | 'effort-select';
interface View {options: SelectOption[]; value?: string; disabled: boolean}
interface State {
  views: Record<ModelSelectId, View>;
  actions: Partial<Record<ModelSelectId, (value: string) => void>>;
}
const store = createStore<State>(() => ({views: {
  'model-select': {options: [{value: '', label: '等待模型目录'}], disabled: true},
  'effort-select': {options: [{value: '', label: '思考档位'}], disabled: true},
}, actions: {}}));
export function publishModelSelect(id: ModelSelectId, patch: Partial<View>) {
  const previous = store.getState().views[id];
  if (Object.entries(patch).every(([key, value]) => Object.is(previous[key as keyof View], value))) return;
  flushSync(() => store.setState(state => ({views: {...state.views, [id]: {...state.views[id], ...patch}}})));
}
export function installModelSelectActions(actions: State['actions']) { store.setState({actions}); }
export function ModelSelect({id}: {id: ModelSelectId}) {
  const view = useStore(store, state => state.views[id]);
  const select = useRef<HTMLSelectElement>(null);
  // Keep native no-match selection semantics; React owns this node and its options.
  useLayoutEffect(() => {
    if (select.current && view.value !== undefined) select.current.value = view.value;
  }, [view.options, view.value]);
  return <select ref={select} id={id} aria-label={id === 'model-select' ? '选择模型' : '选择思考档位'} disabled={view.disabled}
    onChange={event => {
      const value = event.currentTarget.value;
      publishModelSelect(id, {value});
      store.getState().actions[id]?.(value);
    }}>{view.options.map(option => <option key={option.value} value={option.value} title={option.title || undefined}>{option.label}</option>)}</select>;
}
