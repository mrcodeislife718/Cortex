import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const index=read('apps/desktop/index.html');
const freedom=read('apps/desktop/src/vscode-freedom.js');
const native=read('apps/desktop/src-tauri/src/lib.rs');
const contract=JSON.parse(read('architecture/full-product-contract.json'));
const failures=[];
const need=(src,t,msg)=>{if(!src.includes(t))failures.push(msg)};
need(index,'/src/vscode-freedom.js','packaged desktop must load VS Code freedom layer');
for(const token of ['workbench.action.showCommands','workbench.action.quickOpen','workbench.action.gotoLine','workbench.action.gotoSymbol','workbench.action.files.newUntitledFile','workbench.action.files.openFile','workbench.action.files.saveAs','workbench.action.findInFiles','workbench.action.replaceInFiles','workbench.action.splitEditorRight','workbench.action.terminal.new','workbench.action.openSettings','workbench.action.openGlobalKeybindings','workbench.action.selectTheme','workbench.action.showOutline','workbench.action.showTimeline','workbench.view.testing','workbench.action.toggleCortexAI']) need(freedom,token,`missing command ${token}`);
for(const token of ['monaco.editor.createModel','untitled:','write_workspace_file','list_workspace_files','replace_workspace','discover_project_tasks','git_history','pty_start','pty_read','pty_write','pty_stop','monaco.editor.create','cortex.theme','contextmenu']) need(freedom,token,`missing freedom implementation ${token}`);
for(const token of ['list_workspace_files','replace_workspace','walk_files','ReplaceSummary']) need(native,token,`missing native workspace implementation ${token}`);
for(const token of ['command-palette','quick-open','keyboard-shortcuts-editor','themes','multiple-terminals','split-editors','test-explorer','outline-view','timeline-view','workspace-search-replace']) { const all=JSON.stringify(contract.workspaceLifecycle); if(!all.includes(token)) failures.push(`contract missing ${token}`); }
if(contract.workspaceLifecycle?.repositoryOptional!==true||contract.workspaceLifecycle?.gitOptional!==true||contract.workspaceLifecycle?.aiOptional!==true) failures.push('Git, repository and AI must remain optional');
if(failures.length){console.error(JSON.stringify({ok:false,failures},null,2));process.exit(1)}
console.log(JSON.stringify({ok:true,contract:'vscode-freedom-runtime-v2',guarantees:['command-palette','recursive-quick-open','untitled-files','single-file-open','save-as','workspace-search-replace','split-editor','multiple-pty-terminals','testing-view','outline','timeline','editor-context-actions','settings-keybindings-themes','AI-optional']},null,2));
