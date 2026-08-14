import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace, TextDocument, LanguageClientRegistry, DiagnosticStore, SymbolGraph, DebugSession, ProvenanceView, EcosystemPanels, MemoryInspector, AIEditEngine, Cortex } from '../src/index.js';

test('workspace discovers, edits, saves, and prevents path escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-'));
  await fs.mkdir(path.join(root,'src')); await fs.writeFile(path.join(root,'src','main.cannon'),'let x = 1\n');
  const workspace = new Workspace(root);
  assert.equal((await workspace.discover()).length, 1);
  const doc = await workspace.open('src/main.cannon');
  doc.applyEdit({start:8,end:9,text:'2'}); assert.equal(doc.dirty,true);
  await workspace.save('src/main.cannon'); assert.equal(doc.dirty,false);
  assert.match(await fs.readFile(path.join(root,'src','main.cannon'),'utf8'), /2/);
  await assert.rejects(() => workspace.open('../escape.cannon'), /escapes workspace/);
});

test('language clients feed diagnostics and symbol graph', async () => {
  const clients = new LanguageClientRegistry();
  clients.register('cannon',{request:async(method)=>method.includes('diagnostic')?[{code:'N1',message:'demo',start:0,end:1}]:[{name:'x',start:0,end:1}]});
  const cortex = new Cortex({languages:clients,diagnostics:new DiagnosticStore(),symbols:new SymbolGraph()});
  const doc = new TextDocument('/demo.cannon','x');
  const result = await cortex.analyze('cannon',doc);
  assert.equal(result.diagnostics[0].code,'N1');
  assert.equal(cortex.symbols.find('x').length,1);
});

test('debugger, provenance, panels, and memory inspector expose runtime state', async () => {
  const debug = new DebugSession({start:async()=>true,evaluate:async({expression})=>({expression,value:42}),stop:async()=>true});
  await debug.start(); debug.setBreakpoint('a.cannon',3); assert.equal((await debug.inspect(1,'x')).value,42); await debug.stop();
  const provenance = new ProvenanceView().add({id:'source'}).add({id:'output'}).link('source','output','compiled');
  assert.deepEqual(provenance.trace('source').map(n=>n.id),['source','output']);
  const panels = new EcosystemPanels().register('syncio',async()=>({records:1})); assert.equal((await panels.data('syncio')).records,1);
  const memory = new MemoryInspector(); memory.capture({allocations:[{id:'a',released:false}],pointers:[{id:'p',target:'missing'}]}); assert.equal(memory.leaks().length,1); assert.equal(memory.danglingPointers().length,1);
});

test('AI edits remain review-gated and compiler-validated', async () => {
  const engine = new AIEditEngine({generate:async()=>({edits:[{start:0,end:1,text:'y'}]})},{validate:async()=>({ok:true,checks:['nova']})});
  const proposal = await engine.propose({files:{'a.cannon':'x'},instruction:'rename'});
  assert.equal(proposal.status,'review');
  const doc = new TextDocument('a.cannon','x'); engine.apply(doc,proposal,0); assert.equal(doc.text,'y');
  const rejected = new AIEditEngine({generate:async()=>({edits:[]})},{validate:async()=>({ok:false})});
  assert.equal((await rejected.propose({files:{},instruction:'bad'})).status,'rejected');
});
