use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, time::Duration};
use tauri::State;

use crate::{run_bounded, workspace_root, CommandResult, WorkspaceState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTask {
    name: String,
    command: String,
    package_manager: String,
    kind: String,
}

#[tauri::command]
pub fn create_workspace_file(relative: String, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let target = resolve_new(&root, &relative)?;
    fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_workspace_directory(relative: String, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let target = resolve_new(&root, &relative)?;
    fs::create_dir(target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_workspace_entry(relative: String, destination: String, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let source = resolve_existing(&root, &relative)?;
    let target = resolve_new(&root, &destination)?;
    if target.exists() { return Err("destination already exists".into()); }
    fs::rename(source, target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_workspace_entry(relative: String, state: State<'_, WorkspaceState>) -> Result<(), String> {
    if relative.trim().is_empty() { return Err("workspace root cannot be deleted".into()); }
    let root = workspace_root(&state)?;
    let target = resolve_existing(&root, &relative)?;
    if target == root { return Err("workspace root cannot be deleted".into()); }
    if target.is_dir() { fs::remove_dir_all(target).map_err(|error| error.to_string()) }
    else { fs::remove_file(target).map_err(|error| error.to_string()) }
}

#[tauri::command]
pub fn git_diff(relative: Option<String>, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    let root = workspace_root(&state)?;
    let mut args = vec!["diff".into(), "--".into()];
    if let Some(relative) = relative { validate_git_path(&relative)?; args.push(relative); }
    run_bounded(&root, "git", &args, Duration::from_secs(15))
}

#[tauri::command]
pub fn git_stage(paths: Vec<String>, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    let root = workspace_root(&state)?;
    let paths = validate_git_paths(paths)?;
    let mut args = vec!["add".into(), "--".into()];
    args.extend(paths);
    run_bounded(&root, "git", &args, Duration::from_secs(20))
}

#[tauri::command]
pub fn git_unstage(paths: Vec<String>, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    let root = workspace_root(&state)?;
    let paths = validate_git_paths(paths)?;
    let mut args = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(paths);
    run_bounded(&root, "git", &args, Duration::from_secs(20))
}

#[tauri::command]
pub fn git_commit(message: String, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 4096 { return Err("commit message must be 1-4096 characters".into()); }
    run_bounded(&workspace_root(&state)?, "git", &["commit".into(), "-m".into(), message.into()], Duration::from_secs(60))
}

#[tauri::command]
pub fn discover_project_tasks(state: State<'_, WorkspaceState>) -> Result<Vec<ProjectTask>, String> {
    let root = workspace_root(&state)?;
    let manifest = root.join("package.json");
    if !manifest.is_file() { return Ok(Vec::new()); }
    let text = fs::read_to_string(manifest).map_err(|error| error.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|error| format!("invalid package.json: {error}"))?;
    let scripts = value.get("scripts").and_then(|value| value.as_object()).cloned().unwrap_or_default();
    let manager = detect_package_manager(&root);
    let mut tasks = scripts.into_iter().map(|(name, command)| {
        let kind = classify_task(&name);
        ProjectTask { name, command: command.as_str().unwrap_or("").to_string(), package_manager: manager.clone(), kind }
    }).collect::<Vec<_>>();
    tasks.sort_by(|a, b| task_rank(&a.kind).cmp(&task_rank(&b.kind)).then_with(|| a.name.cmp(&b.name)));
    Ok(tasks)
}

#[tauri::command]
pub fn run_project_task(name: String, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 || !name.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '-' | '_' | '.')) { return Err("invalid project task name".into()); }
    let root = workspace_root(&state)?;
    let manifest = root.join("package.json");
    let text = fs::read_to_string(manifest).map_err(|_| "package.json is required for package tasks".to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|error| format!("invalid package.json: {error}"))?;
    if value.get("scripts").and_then(|value| value.get(name)).and_then(|value| value.as_str()).is_none() { return Err("unknown project task".into()); }
    let manager = detect_package_manager(&root);
    let (command, args): (&str, Vec<String>) = match manager.as_str() {
        "pnpm" => ("pnpm", vec!["run".into(), name.into()]),
        "yarn" => ("yarn", vec!["run".into(), name.into()]),
        "bun" => ("bun", vec!["run".into(), name.into()]),
        _ => ("npm", vec!["run".into(), name.into()]),
    };
    run_bounded(&root, command, &args, Duration::from_secs(300))
}

fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let candidate = fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?;
    if !candidate.starts_with(root) { return Err("workspace path escape denied".into()); }
    Ok(candidate)
}

fn resolve_new(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let raw = root.join(relative);
    let parent = raw.parent().ok_or("invalid workspace path")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(root) { return Err("workspace path escape denied".into()); }
    Ok(canonical_parent.join(raw.file_name().ok_or("invalid workspace name")?))
}

fn validate_relative(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 4096 { return Err("invalid workspace-relative path".into()); }
    let path = Path::new(value);
    if path.is_absolute() || path.components().any(|component| matches!(component, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_))) { return Err("workspace path escape denied".into()); }
    Ok(())
}

fn validate_git_path(value: &str) -> Result<(), String> { validate_relative(value) }
fn validate_git_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > 1024 { return Err("Git operation requires 1-1024 workspace paths".into()); }
    for value in &paths { validate_git_path(value)?; }
    Ok(paths)
}

fn detect_package_manager(root: &Path) -> String {
    (if root.join("pnpm-lock.yaml").is_file() { "pnpm" }
    else if root.join("yarn.lock").is_file() { "yarn" }
    else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() { "bun" }
    else { "npm" }).to_string()
}
fn classify_task(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    (if lower == "test" || lower.starts_with("test:") { "test" }
    else if lower == "build" || lower.starts_with("build:") { "build" }
    else if matches!(lower.as_str(), "dev" | "start" | "serve") { "run" }
    else if lower.contains("lint") || lower.contains("check") || lower.contains("typecheck") { "check" }
    else { "task" }).to_string()
}
fn task_rank(kind: &str) -> u8 { match kind { "run" => 0, "test" => 1, "build" => 2, "check" => 3, _ => 4 } }
