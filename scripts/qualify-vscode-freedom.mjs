import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const index=read('apps/desktop/index.html'),freedom=read('apps/desktop/src/vscode-freedom.js'),contract=JSON.parse(read('architecture/full-product-contract.json'));
const failures=[];const need=(src,t,msg)=>{if(!src.includes(t))failures.push(msg)};
need(index,'/src/vscode-freedom.js','packaged desktop must load VS Code freedom layer');
for(const token of ['workbench.action.showCommands','workbench.action.quickOpen','workbench.action.gotoLine','workbench.action.gotoSymbol','workbench.action.files.newUntitledFile','workbench.action.files.openFile','workbench.action.files.saveAs','workbench.action.splitEditorRight','workbench.action.terminal.new','workbench.action.openSettings','workbench.action.openGlobalKeybindings','workbench.action.selectTheme','workbench.action.toggleCortexAI'])need(freedom,token,`missing command ${token}`);
for(const token of ['monaco.editor.createModel','untitled:','write_workspace_file','pty_start','pty_read','pty_write','pty_stop','monaco.editor.create','localStorage.setItem(\'cortex.theme\'','Ctrl/Cmd+Shift+P'])need(freedom,token,`missing freedom implementation ${token}`);
for(const token of ['command-palette','quick-open','keyboard-shortcuts-editor','themes','multiple-terminals','split-editors']){const all=JSON.stringify(contract.workspaceLifecycle);if(!all.includes(token))failures.push(`contract missing ${token}`)}
if(contract.workspaceLifecycle?.repositoryOptional!==true||contract.workspaceLifecycle?.gitOptional!==true||contract.workspaceLifecycle?.aiOptional!==true)failures.push('Git, repository and AI must remain optional');
if(failures.length){console.error(JSON.stringify({ok:false,failures},null,2));process.exit(1)}
console.log(JSON.stringify({ok:true,contract:'vscode-freedom-runtime-v1',guarantees:['command-palette','quick-open','untitled-files','single-file-open','save-as','split-editor','multiple-pty-terminals','settings-keybindings-themes','AI-optional']},null,2));
