import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class StdioLanguageClient extends EventEmitter {
  constructor(command,args=[],options={}){super();this.command=command;this.args=args;this.options=options;this.child=null;this.buffer=Buffer.alloc(0);this.nextId=1;this.pending=new Map();}
  async start(){if(this.child)return this;this.child=spawn(this.command,this.args,{...this.options,stdio:['pipe','pipe','pipe']});this.child.stdout.on('data',(chunk)=>{this.buffer=Buffer.concat([this.buffer,chunk]);this.#drain();});this.child.stderr.on('data',(chunk)=>this.emit('stderr',chunk.toString()));this.child.on('exit',(code)=>{for(const {reject} of this.pending.values())reject(new Error(`language server exited ${code}`));this.pending.clear();this.emit('exit',code);});await this.request('initialize',{processId:process.pid,capabilities:{},rootUri:null});this.notify('initialized',{});return this;}
  request(method,params={}){if(!this.child)throw new Error('language client is not started');const id=this.nextId++;this.#send({jsonrpc:'2.0',id,method,params});return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));}
  notify(method,params={}){if(!this.child)throw new Error('language client is not started');this.#send({jsonrpc:'2.0',method,params});}
  async close(){if(!this.child)return;try{await this.request('shutdown',{});}catch{}this.notify('exit',{});this.child.stdin.end();await new Promise((resolve)=>{if(this.child.exitCode!=null)return resolve();const timer=setTimeout(()=>{this.child.kill('SIGKILL');resolve();},1000);this.child.once('exit',()=>{clearTimeout(timer);resolve();});});this.child=null;}
  #send(message){const json=JSON.stringify(message);this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);}
  #drain(){while(true){const marker=this.buffer.indexOf('\r\n\r\n');if(marker<0)return;const header=this.buffer.subarray(0,marker).toString();const match=/Content-Length:\s*(\d+)/i.exec(header);if(!match)return;const length=Number(match[1]);if(this.buffer.length<marker+4+length)return;const body=JSON.parse(this.buffer.subarray(marker+4,marker+4+length).toString());this.buffer=this.buffer.subarray(marker+4+length);if(body.id!=null&&this.pending.has(body.id)){const pending=this.pending.get(body.id);this.pending.delete(body.id);body.error?pending.reject(new Error(body.error.message)):pending.resolve(body.result);}else this.emit('notification',body);}}
}

export class ProcessTerminalAdapter {
  constructor({cwd=process.cwd(),env=process.env}={}){this.cwd=cwd;this.env=env;}
  run(command,args=[],options={}){return run(command,args,{cwd:options.cwd??this.cwd,env:{...this.env,...options.env}});}
}
export class GitCliAdapter {
  constructor(root){this.root=path.resolve(root);}
  async status(){const r=await run('git',['status','--porcelain=v1','-b'],{cwd:this.root});ensure(r);return r.stdout;}
  async diff(file){const r=await run('git',['diff','--',file],{cwd:this.root});ensure(r);return r.stdout;}
  async commit(message,files=[]){if(files.length){const add=await run('git',['add','--',...files],{cwd:this.root});ensure(add);}const r=await run('git',['commit','-m',message],{cwd:this.root});ensure(r);return r.stdout;}
  async branches(){const r=await run('git',['branch','--format=%(refname:short)'],{cwd:this.root});ensure(r);return r.stdout.trim().split(/\r?\n/).filter(Boolean);}
}
export class CannonProcessDebugAdapter extends EventEmitter {
  constructor({node=process.execPath,cannonCli,cwd=process.cwd()}={}){super();if(!cannonCli)throw new Error('cannonCli is required');this.node=node;this.cannonCli=cannonCli;this.cwd=cwd;this.child=null;this.output={stdout:'',stderr:''};}
  async start({program}={}){if(!program)throw new Error('debug program is required');this.output={stdout:'',stderr:''};this.child=spawn(this.node,[this.cannonCli,program],{cwd:this.cwd,stdio:['ignore','pipe','pipe']});this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');this.child.stdout.on('data',(c)=>{this.output.stdout+=c;this.emit('output',{stream:'stdout',data:c});});this.child.stderr.on('data',(c)=>{this.output.stderr+=c;this.emit('output',{stream:'stderr',data:c});});const exit=new Promise((resolve,reject)=>{this.child.once('error',reject);this.child.once('exit',(code,signal)=>resolve({code,signal,...this.output}));});this.exit=exit;return{pid:this.child.pid,exit};}
  async evaluate({expression}){if(expression==='process.pid')return this.child?.pid??null;if(expression==='output')return structuredClone(this.output);throw new Error(`unsupported process debug expression: ${expression}`);}
  async continue(){return this.exit;}
  async pause(){if(!this.child||this.child.exitCode!=null)return false;return this.child.kill('SIGSTOP');}
  async stop(){if(!this.child||this.child.exitCode!=null)return this.exit;this.child.kill('SIGTERM');return this.exit;}
}

function run(command,args,{cwd,env}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',(c)=>stdout+=c);child.stderr.on('data',(c)=>stderr+=c);child.once('error',reject);child.once('exit',(code,signal)=>resolve({ok:code===0,code,signal,stdout,stderr,command:{command,args}}));});}
function ensure(result){if(!result.ok)throw new Error(result.stderr||`${result.command.command} exited ${result.code}`);return result;}
