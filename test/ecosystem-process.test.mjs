import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MemoryInspector, ReleaseController } from '../src/index.js';
import { StdioLanguageClient, ProcessTerminalAdapter, GitCliAdapter, CannonProcessDebugAdapter } from '../src/process-integration.js';

const roots=Object.fromEntries(['SCOUT','NOVA','CANNON','CANNON_PLUS','VELOCITY','CHRONOS'].map((name)=>[name,process.env[`${name}_REPO`]]));
const integration=Object.values(roots).every(Boolean);
const maybe={skip:!integration};
const fileUrl=(root,relative)=>pathToFileURL(path.join(root,relative)).href;

test('Cortex drives real Scout and Nova stdio language server processes',maybe,async(t)=>{
  const scout=new StdioLanguageClient(process.execPath,[path.join(roots.SCOUT,'src','lsp-stdio.js')]);
  const nova=new StdioLanguageClient(process.execPath,[path.join(roots.NOVA,'src','lsp-stdio.js')]);
  t.after(()=>Promise.all([scout.close(),nova.close()]));
  await scout.start(); await nova.start();
  const scoutUri='file:///proof.scout'; const scoutText='{\n  // config\n  name: "proof",\n  enabled: true,\n}\n';
  scout.notify('textDocument/didOpen',{textDocument:{uri:scoutUri,languageId:'scout',version:1,text:scoutText}});
  const scoutDiagnostics=await scout.request('textDocument/diagnostic',{textDocument:{uri:scoutUri}});
  assert.equal(scoutDiagnostics.kind,'full'); assert.equal(scoutDiagnostics.items.length,0);
  const completion=await scout.request('textDocument/completion',{textDocument:{uri:scoutUri},position:{line:2,character:3}});assert.ok(Array.isArray(completion.items));
  const folding=await scout.request('textDocument/foldingRange',{textDocument:{uri:scoutUri}});assert.ok(Array.isArray(folding));

  const cannonUri='file:///proof.cannon';const cannonText='fn add(a: i32, b: i32) -> i32 {\n  return 42\n}\n';
  nova.notify('textDocument/didOpen',{textDocument:{uri:cannonUri,languageId:'cannon',version:1,text:cannonText}});
  const novaDiagnostics=await nova.request('textDocument/diagnostic',{textDocument:{uri:cannonUri},text:cannonText});assert.equal(novaDiagnostics.length,0);
  const symbols=await nova.request('textDocument/documentSymbol',{textDocument:{uri:cannonUri},text:cannonText});assert.equal(symbols[0].name,'add');
});

test('Cortex terminal and Git adapters execute real processes and mutate a real repository',maybe,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-git-'));spawnSync('git',['init','-q'],{cwd:root});spawnSync('git',['config','user.email','proof@example.com'],{cwd:root});spawnSync('git',['config','user.name','Cortex Proof'],{cwd:root});await fs.writeFile(path.join(root,'proof.txt'),'one\n');
  const terminal=new ProcessTerminalAdapter({cwd:root});const node=await terminal.run(process.execPath,['-e','process.stdout.write("terminal-ok")']);assert.equal(node.stdout,'terminal-ok');
  const git=new GitCliAdapter(root);assert.match(await git.status(),/proof\.txt/);await git.commit('initial',['proof.txt']);assert.ok((await git.branches()).length===1);await fs.writeFile(path.join(root,'proof.txt'),'two\n');assert.match(await git.diff('proof.txt'),/-one/);
});

test('Cortex debug adapter launches and observes a real Cannon program process',maybe,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cortex-cannon-'));const program=path.join(root,'debug.cannon');await fs.writeFile(program,'print("debug-ready")\n');const adapter=new CannonProcessDebugAdapter({cannonCli:path.join(roots.CANNON,'src','cli.js'),cwd:root});const started=await adapter.start({program});assert.ok(started.pid>0);const pid=await adapter.evaluate({expression:'process.pid'});assert.equal(pid,started.pid);const result=await adapter.continue();assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'debug-ready');
});

test('Cortex memory inspector consumes real Cannon Plus region snapshots and catches live allocations',maybe,async()=>{
  const plus=await import(fileUrl(roots.CANNON_PLUS,'src/index.js'));const region=new plus.Region({name:'cortex',capacity:32});const pointer=region.allocate(8,42);const inspector=new MemoryInspector();const first=region.snapshot();inspector.capture({allocations:first.allocations.map((entry)=>({...entry,regionReleased:false})),regions:[first],pointers:[{target:first.allocations[0].id}]});assert.equal(inspector.leaks().length,1);pointer.release();const second=region.snapshot();inspector.capture({allocations:second.allocations.map((entry)=>({...entry,regionReleased:entry.released})),regions:[second],pointers:[]});assert.equal(inspector.leaks().length,0);
});

test('Cortex release controls call real Velocity planning and Chronos release state',maybe,async()=>{
  const velocity=await import(fileUrl(roots.VELOCITY,'src/index.js'));const chronos=await import(fileUrl(roots.CHRONOS,'src/index.js'));const app=velocity.defineApp({name:'proof',targets:['web'],entry:'src/main.cannon'});const store=new chronos.ReleaseStore();const artifact=chronos.createArtifact({app:'proof',version:'1.0.0',target:'web',files:[{path:'app.js',content:'ok'}]});store.putArtifact(artifact);
  const controller=new ReleaseController({velocity:{createBuildPlan:(a,o)=>velocity.createBuildPlan(a,o)},chronos:{createRelease:(spec)=>store.createRelease(spec),promote:(id,threshold)=>store.promote(id,threshold),rollback:(env,channel)=>store.rollback(env,channel)}});const plan=controller.plan(app);assert.ok(plan.steps.length>0);const release=controller.deploy({artifactDigest:artifact.digest,environment:{name:'proof',strategy:'immediate'}});store.recordHealth(release.id,{healthy:true,healthyPercent:100});const active=controller.promote(release.id,100);assert.equal(active.status,'active');
});
