use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::State;

struct WorkspaceState(Mutex<Option<PathBuf>>);
const CREDENTIAL_SERVICE: &str = "Cortex";
const CREDENTIAL_USER: &str = "commercial-session";

#[derive(Serialize)]
struct RuntimeInfo { name: &'static str, version: &'static str, architecture: &'static str }
#[derive(Serialize)]
struct WorkspaceEntry { name: String, relative_path: String, is_directory: bool, bytes: Option<u64> }
#[derive(Serialize)]
struct SearchMatch { relative_path: String, line: usize, preview: String }
#[derive(Serialize)]
struct CommandResult { ok: bool, code: Option<i32>, stdout: String, stderr: String }
#[derive(Deserialize)]
struct ActivationResponse { token: String }

#[tauri::command]
fn runtime_info() -> RuntimeInfo { RuntimeInfo { name: "Cortex", version: env!("CARGO_PKG_VERSION"), architecture: std::env::consts::ARCH } }

#[tauri::command]
fn set_workspace(path: String, state: State<'_, WorkspaceState>) -> Result<String, String> {
    let root = fs::canonicalize(&path).map_err(|error| format!("workspace unavailable: {error}"))?;
    if !root.is_dir() { return Err("workspace must be a directory".into()); }
    *state.0.lock().map_err(|_| "workspace state poisoned")? = Some(root.clone());
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn list_workspace(relative: Option<String>, state: State<'_, WorkspaceState>) -> Result<Vec<WorkspaceEntry>, String> {
    let root = workspace_root(&state)?;
    let target = resolve_existing(&root, relative.as_deref().unwrap_or(""))?;
    if !target.is_dir() { return Err("workspace target must be a directory".into()); }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&target).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored(&name) { continue; }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let relative_path = entry.path().strip_prefix(&root).map_err(|_| "workspace path escape")?.to_string_lossy().replace('\\', "/");
        entries.push(WorkspaceEntry { name, relative_path, is_directory: metadata.is_dir(), bytes: metadata.is_file().then_some(metadata.len()) });
    }
    entries.sort_by(|a, b| b.is_directory.cmp(&a.is_directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
fn read_workspace_file(relative: String, state: State<'_, WorkspaceState>) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let target = resolve_existing(&root, &relative)?;
    if !target.is_file() { return Err("workspace target must be a file".into()); }
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if metadata.len() > 8 * 1024 * 1024 { return Err("file exceeds Cortex interactive read limit".into()); }
    fs::read_to_string(target).map_err(|error| format!("file is not readable UTF-8 text: {error}"))
}

#[tauri::command]
fn write_workspace_file(relative: String, text: String, state: State<'_, WorkspaceState>) -> Result<(), String> {
    if text.len() > 16 * 1024 * 1024 { return Err("file exceeds Cortex interactive write limit".into()); }
    let root = workspace_root(&state)?;
    let target = resolve_for_write(&root, &relative)?;
    let suffix = target.extension().and_then(|value| value.to_str()).unwrap_or("file");
    let temp = target.with_extension(format!("{suffix}.cortex-tmp"));
    fs::write(&temp, text).map_err(|error| error.to_string())?;
    fs::rename(&temp, &target).map_err(|error| error.to_string())
}

#[tauri::command]
fn search_workspace(query: String, state: State<'_, WorkspaceState>) -> Result<Vec<SearchMatch>, String> {
    if query.trim().is_empty() || query.len() > 256 { return Err("search query must be 1-256 characters".into()); }
    let root = workspace_root(&state)?;
    let mut matches = Vec::new();
    walk_search(&root, &root, &query, &mut matches, 500)?;
    Ok(matches)
}

#[tauri::command]
fn git_status(state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    run_bounded(&workspace_root(&state)?, "git", &["status".into(), "--porcelain=v1".into(), "-b".into()], Duration::from_secs(10))
}

#[tauri::command]
fn run_workspace_command(command: String, args: Vec<String>, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    if command.is_empty() || command.contains('/') || command.contains('\\') { return Err("command must be an executable name, not a path".into()); }
    if args.len() > 256 || args.iter().any(|arg| arg.len() > 8192) { return Err("command arguments exceed Cortex limits".into()); }
    run_bounded(&workspace_root(&state)?, &command, &args, Duration::from_secs(120))
}

#[tauri::command]
fn has_commercial_session() -> bool { credential_entry().and_then(|entry| entry.get_password().ok()).is_some() }

#[tauri::command]
fn clear_commercial_session() -> Result<(), String> {
    let entry = credential_entry()?;
    match entry.delete_credential() { Ok(_) => Ok(()), Err(keyring::Error::NoEntry) => Ok(()), Err(error) => Err(format!("credential deletion failed: {error}")) }
}

#[tauri::command]
async fn redeem_activation(api_url: String, code: String) -> Result<(), String> {
    let base = validate_api_url(&api_url)?;
    if code.trim().len() < 20 || code.trim().len() > 128 { return Err("activation code is invalid".into()); }
    let response = reqwest::Client::new().post(format!("{base}?action=activation-redeem")).json(&serde_json::json!({"code": code.trim()})).send().await.map_err(|error| format!("activation service unavailable: {error}"))?;
    if !response.status().is_success() { return Err(format!("activation failed ({})", response.status().as_u16())); }
    let activation: ActivationResponse = response.json().await.map_err(|error| format!("invalid activation response: {error}"))?;
    credential_entry()?.set_password(&activation.token).map_err(|error| format!("credential storage failed: {error}"))
}

#[tauri::command]
async fn commercial_entitlements(api_url: String) -> Result<serde_json::Value, String> {
    let base = validate_api_url(&api_url)?;
    let token = credential_entry()?.get_password().map_err(|error| format!("Cortex session unavailable: {error}"))?;
    let response = reqwest::Client::new().get(format!("{base}?action=entitlements")).bearer_auth(token).send().await.map_err(|error| format!("entitlement service unavailable: {error}"))?;
    if response.status().as_u16() == 401 { let _ = clear_commercial_session(); return Err("Cortex session expired".into()); }
    if !response.status().is_success() { return Err(format!("entitlement check failed ({})", response.status().as_u16())); }
    response.json().await.map_err(|error| format!("invalid entitlement response: {error}"))
}

fn credential_entry() -> Result<keyring::Entry, String> { keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| format!("credential vault unavailable: {error}")) }
fn validate_api_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://127.0.0.1") && !trimmed.starts_with("http://localhost") { return Err("commercial API must use HTTPS".into()); }
    Ok(trimmed.to_string())
}
fn workspace_root(state: &State<'_, WorkspaceState>) -> Result<PathBuf, String> { state.0.lock().map_err(|_| "workspace state poisoned")?.clone().ok_or_else(|| "no workspace is open".into()) }
fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> { let candidate = fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?; if !candidate.starts_with(root) { return Err("workspace path escape denied".into()); } Ok(candidate) }
fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, String> { let raw = root.join(relative); let parent = raw.parent().ok_or("invalid workspace path")?; let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?; if !canonical_parent.starts_with(root) { return Err("workspace path escape denied".into()); } Ok(canonical_parent.join(raw.file_name().ok_or("invalid file name")?)) }
fn walk_search(root: &Path, dir: &Path, query: &str, output: &mut Vec<SearchMatch>, limit: usize) -> Result<(), String> {
    if output.len() >= limit { return Ok(()); }
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        if output.len() >= limit { break; }
        let entry = entry.map_err(|error| error.to_string())?; let name = entry.file_name().to_string_lossy().to_string(); if is_ignored(&name) { continue; }
        let path = entry.path(); let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() { walk_search(root, &path, query, output, limit)?; continue; }
        if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 { continue; }
        let Ok(text) = fs::read_to_string(&path) else { continue; };
        for (index, line) in text.lines().enumerate() { if line.contains(query) { output.push(SearchMatch { relative_path: path.strip_prefix(root).map_err(|_| "workspace path escape")?.to_string_lossy().replace('\\', "/"), line: index + 1, preview: line.chars().take(240).collect() }); if output.len() >= limit { break; } } }
    }
    Ok(())
}
fn is_ignored(name: &str) -> bool { matches!(name, ".git" | "node_modules" | "dist" | "build" | "coverage" | ".next" | ".turbo") }

fn run_bounded(root: &Path, command: &str, args: &[String], timeout: Duration) -> Result<CommandResult, String> {
    const MAX_OUTPUT: u64 = 2 * 1024 * 1024;
    let mut child = Command::new(command).args(args).current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?; let stderr = child.stderr.take().ok_or("failed to capture stderr")?;
    let stdout_reader = thread::spawn(move || { let mut bytes = Vec::new(); let _ = stdout.take(MAX_OUTPUT + 1).read_to_end(&mut bytes); bytes });
    let stderr_reader = thread::spawn(move || { let mut bytes = Vec::new(); let _ = stderr.take(MAX_OUTPUT + 1).read_to_end(&mut bytes); bytes });
    let started = Instant::now();
    let status = loop { if let Some(status) = child.try_wait().map_err(|error| error.to_string())? { break status; } if started.elapsed() >= timeout { let _ = child.kill(); let _ = child.wait(); return Err(format!("command exceeded {}ms", timeout.as_millis())); } thread::sleep(Duration::from_millis(20)); };
    let stdout = stdout_reader.join().map_err(|_| "stdout reader failed")?; let stderr = stderr_reader.join().map_err(|_| "stderr reader failed")?;
    if stdout.len() as u64 > MAX_OUTPUT || stderr.len() as u64 > MAX_OUTPUT || stdout.len() + stderr.len() > MAX_OUTPUT as usize { return Err("command output exceeded Cortex interactive limit".into()); }
    Ok(CommandResult { ok: status.success(), code: status.code(), stdout: String::from_utf8_lossy(&stdout).to_string(), stderr: String::from_utf8_lossy(&stderr).to_string() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WorkspaceState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![runtime_info, set_workspace, list_workspace, read_workspace_file, write_workspace_file, search_workspace, git_status, run_workspace_command, has_commercial_session, clear_commercial_session, redeem_activation, commercial_entitlements])
        .run(tauri::generate_context!())
        .expect("failed to run Cortex desktop runtime");
}
