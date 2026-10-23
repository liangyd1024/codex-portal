import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Manager} from '../lib/manager.mjs';

function connected() {
  const manager = new Manager({host:{id:"test",alias:"test"}});
  manager.connection.state = 'connected';
  manager.rpc = {connected:true};
  manager.projects = [{id:'old'}];
  manager.models = [{model:'old'}];
  return manager;
}

test('refresh reads changed projects and all model pages without reconnecting', async () => {
  const manager = connected(), rpc = manager.rpc;
  let revision = 1;
  manager.serviceAction = async action => {
    assert.equal(action,'projects');
    return {data:[{id:`project-${revision}`}]};
  };
  rpc.request = async (method,params) => {
    assert.equal(method,'model/list');
    return params.cursor ? {data:[{model:`second-${revision}`}]} : {data:[{model:`first-${revision}`}],nextCursor:'page2'};
  };
  for (revision = 1; revision <= 2; revision++) {
    assert.deepEqual(await manager.refreshCatalog('projects'),[{id:`project-${revision}`}]);
    assert.deepEqual(await manager.refreshCatalog('models'),[{model:`first-${revision}`},{model:`second-${revision}`}]);
    assert.equal(manager.rpc,rpc);
    assert.equal(manager.connection.state,'connected');
  }
});

test('failed refresh reports failure and preserves the last complete catalog', async () => {
  const manager = connected();
  manager.serviceAction = async () => {throw new Error('read failed');};
  manager.rpc.request = async (_,params) => {
    if (params.cursor) throw new Error('page failed');
    return {data:[{model:'partial'}],nextCursor:'page2'};
  };
  await assert.rejects(manager.refreshCatalog('projects'),/read failed/);
  await assert.rejects(manager.refreshCatalog('models'),/page failed/);
  assert.deepEqual(manager.projects,[{id:'old'}]);
  assert.deepEqual(manager.models,[{model:'old'}]);
});

test('refresh from a replaced connection cannot overwrite current catalogs', async () => {
  const manager = connected();
  let finish;
  manager.serviceAction = () => new Promise(resolve => {finish = resolve;});
  const pending = manager.refreshCatalog('projects');
  manager.generation++;
  finish({data:[{id:'stale'}]});
  await assert.rejects(pending,{code:'CONNECTION_CHANGED'});
  assert.deepEqual(manager.projects,[{id:'old'}]);
});
