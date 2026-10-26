import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function check(code){const result=spawnSync('/usr/bin/python3',['-c',`import runpy,json,pathlib,tempfile,unittest.mock as mock\nm=runpy.run_path(${JSON.stringify(root+'scripts/protocol-check.py')})\nschema=json.loads(pathlib.Path(${JSON.stringify(root+'test/fixtures/request-contract.json')}).read_text())\n${code}`],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr||result.stdout);}
test('contract validation accepts compatible releases without a version allowlist',()=>check(`assert m['validate_request_schema'](schema)['status']=='validated'`));
test('removed optional methods and parameters disable only their dependent operations',()=>check(`
import copy
for method,field in [('thread/queue/list',None),('thread/queue/update',None),('turn/start','effort')]:
 changed=copy.deepcopy(schema)
 entry=next(e for e in changed['oneOf'] if method in e['properties']['method']['enum'])
 if field: m['dereference'](changed,entry['properties']['params'])['properties'].pop(field)
 else: changed['oneOf'].remove(entry)
 result=m['validate_request_schema'](changed)
 assert result['status']=='limited' and method in result['unsupportedMethods']
 feature={'thread/queue/list':'queue','thread/queue/update':'queueEdit','turn/start':'message'}[method]
 assert not result['features'][feature]['supported']
 assert result['features']['takeover']['supported']
`));
test('new mandatory fields disable affected mutations instead of silently ignoring them',()=>check(`
entry=next(e for e in schema['oneOf'] if 'turn/start' in e['properties']['method']['enum'])
m['dereference'](schema,entry['properties']['params']).setdefault('required',[]).append('futureRequired')
result=m['validate_request_schema'](schema)
assert not result['features']['message']['supported']
assert 'futureRequired' in result['features']['message']['reason']
`));
test('successful checks are cached by binary identity, version and validation policy',()=>check(`
if True:
 directory=tempfile.mkdtemp(prefix='rcm-protocol-test-')
 root=pathlib.Path(directory);binary=root/'codex';binary.write_text('original');calls=[]
 def generate(args,**kwargs):
  calls.append(args);(pathlib.Path(args[-1])/'ClientRequest.json').write_text(json.dumps(schema));return type('Result',(),{'returncode':0})()
 with mock.patch('subprocess.run',generate):
  assert not m['check_protocol'](binary,'0.163.0-alpha.10.2',root)['cached']
  assert m['check_protocol'](binary,'0.163.0-alpha.10.2',root)['cached']
  binary.write_text('replacement binary')
  assert not m['check_protocol'](binary,'0.163.0-alpha.10.2',root)['cached']
  assert not m['check_protocol'](binary,'future-release',root)['cached']
  m['check_protocol'].__globals__['PROTOCOL_POLICY']+=1
  assert not m['check_protocol'](binary,'future-release',root)['cached']
  assert len(calls)==4
  (root/'protocol-validation.json').write_text('[]')
  assert not m['check_protocol'](binary,'future-release',root)['cached']
`));
test('incompatible schema is never saved as a successful validation',()=>check(`
if True:
 directory=tempfile.mkdtemp(prefix='rcm-protocol-test-')
 root=pathlib.Path(directory);binary=root/'codex';binary.write_text('binary')
 def generate(args,**kwargs):
  (pathlib.Path(args[-1])/'ClientRequest.json').write_text(json.dumps({'oneOf':[]}));return type('Result',(),{'returncode':0})()
 with mock.patch('subprocess.run',generate):
  try: m['check_protocol'](binary,'0.164',root);raise AssertionError('incompatible accepted')
  except RuntimeError: pass
 assert not (root/'protocol-validation.json').exists()
`));

test('missing core handshake interface still blocks the connection',()=>check(`
schema['oneOf']=[entry for entry in schema['oneOf'] if 'initialize' not in entry['properties']['method']['enum']]
try: m['validate_request_schema'](schema);raise AssertionError('missing initialization accepted')
except RuntimeError as e: assert 'initialize' in str(e)
`));
test('reference steering requires native additional context without disabling ordinary steering',()=>check(`
assert m['validate_request_schema'](schema)['features']['threadReferenceSteer']['supported']
entry=next(e for e in schema['oneOf'] if 'turn/steer' in e['properties']['method']['enum'])
m['dereference'](schema,entry['properties']['params'])['properties'].pop('additionalContext')
result=m['validate_request_schema'](schema)
assert not result['features']['threadReferenceSteer']['supported']
assert result['features']['steer']['supported']
assert result['features']['threadReferences']['supported']
`));

test('the actual 0.155 contract retains goals and references through verified optional parameter variants',()=>check(`
legacy=json.loads(pathlib.Path(${JSON.stringify(root+'test/fixtures/request-contract-0.155.json')}).read_text())
old={'oneOf':[{'properties':{'method':{'enum':[name]},'params':{'properties':{field:{} for field in shape['properties']},'required':shape['required']}}} for name,shape in legacy['methods'].items()]}
result=m['validate_request_schema'](old)
assert result['methods']==43
assert result['unsupportedMethods']==['thread/readState/update']
assert result['methodReasons']['thread/readState/update']=='thread/readState/update 接口缺失'
assert all(value['supported'] for value in result['features'].values())
assert result['optionalParams']=={'mcpServerStatus/list':{'serverName':False},'thread/goal/set':{'origin':False},'thread/goal/clear':{'origin':False}}
assert all(all(flags.values()) for flags in m['validate_request_schema'](schema)['optionalParams'].values())
`));
test('legacy exceptions do not waive missing methods, semantic fields or new required fields',()=>check(`
import copy
for method,field,feature in [('thread/goal/set','status','goal'),('thread/goal/clear',None,'goalClear'),('mcpServerStatus/list','threadId','threadReferences'),('mcpServerStatus/list','cursor','threadReferences'),('turn/start','additionalContext','threadReferences')]:
 changed=copy.deepcopy(schema)
 entry=next(e for e in changed['oneOf'] if method in e['properties']['method']['enum'])
 if field: m['dereference'](changed,entry['properties']['params'])['properties'].pop(field)
 else: changed['oneOf'].remove(entry)
 result=m['validate_request_schema'](changed)
 assert not result['features'][feature]['supported']
 assert result['status']=='limited'
 if field=='additionalContext': assert 'turn/start 缺少参数：additionalContext' in result['features'][feature]['reason']
`));
