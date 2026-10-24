import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const entry=path.join(publicRoot,'app.js');
const missingNameCodes=new Set([2304,2552,18004]);

// Legacy JS has not yet completed strict typing. This gate is deliberately
// limited to unresolved names; the existing strict TS gate remains separate.
function missingBindings(append='') {
 const options={allowJs:true,checkJs:true,noEmit:true,allowImportingTsExtensions:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
  moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX,skipLibCheck:true};
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host);
 host.readFile=file=>{const text=read(file);return text!==undefined&&path.resolve(file)===entry?text+append:text;};
 const program=ts.createProgram([entry],options,host);
 return ts.getPreEmitDiagnostics(program).filter(d=>d.file?.fileName.startsWith(publicRoot)&&missingNameCodes.has(d.code)).map(d=>({
  file:path.relative(publicRoot,d.file.fileName),
  line:d.file.getLineAndCharacterOfPosition(d.start).line+1,
  message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),
 }));
}

test('browser controller and imported legacy modules contain no unresolved names',()=>{
 assert.deepEqual(missingBindings(),[]);
});

test('binding gate rejects the removed sidebar variable and missing shorthand bindings',()=>{
 // In-memory mutation only: never modify the working controller for the probe.
 const diagnostics=missingBindings('\nvoid listRead?.promise;\nvoid __rcmMissingBrowserBinding;\nconst __rcmProbe={__rcmMissingShorthand};\n');
 for(const name of ['listRead','__rcmMissingBrowserBinding','__rcmMissingShorthand']){
  assert.ok(diagnostics.some(d=>d.file==='app.js'&&d.message.includes(name)),`Missing diagnostic for ${name}`);
 }
});
