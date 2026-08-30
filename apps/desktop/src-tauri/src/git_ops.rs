use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, time::Duration};
use tauri::State;

use crate::{run_bounded, workspace_root, CommandResult, WorkspaceState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    name: String,
    current: bool,
    upstream: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    sha: String,
    author: String,
    timestamp: i64,
    subject: String,
}

#[tauri::command]
pub fn git_fetch(state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    run_bounded(&workspace_root(&state)?, "git", &["fetch".into(), "--prune".into()], Duration::from_secs(120))
}

#[tauri::command]
pub fn git_pull(state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    run_bounded(&workspace_root(&state)?, "git", &["pull".into(), "--ff-only".into()], Duration::from_secs(120))
}

#[tauri::command]
pub fn git_push(state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    run_bounded(&workspace_root(&state)?, "git", &["push".into()], Duration::from_secs(120))
}

#[tauri::command]
pub fn git_branches(state: State<'_, WorkspaceState>) -> Result<Vec<GitBranch>, String> {
    let result = run_bounded(
        &workspace_root(&state)?,
        "git",
        &["for-each-ref".into(), "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)".into(), "refs/heads".into()],
        Duration::from_secs(15),
    )?;
    if !result.ok { return Err(nonempty(&result.stderr, "Git branch listing failed")); }
    let mut branches = result.stdout.lines().filter_map(|line| {
        let mut fields = line.split('\t');
        let name = fields.next()?.trim().to_string();
        if name.is_empty() { return None; }
        let current = fields.next().map(|value| value.trim() == "*").unwrap_or(false);
        let upstream = fields.next().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
        Some(GitBranch { name, current, upstream })
    }).collect::<Vec<_>>();
    branches.sort_by(|a, b| b.current.cmp(&a.current).then_with(|| a.name.cmp(&b.name)));
    Ok(branches)
}

#[tauri::command]
pub fn git_switch_branch(name: String, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    validate_ref_name(&name)?;
    run_bounded(&workspace_root(&state)?, "git", &["switch".into(), name], Duration::from_secs(30))
}

#[tauri::command]
pub fn git_create_branch(name: String, state: State<'_, WorkspaceState>) -> Result<CommandResult, String> {
    validate_ref_name(&name)?;
    run_bounded(&workspace_root(&state)?, "git", &["switch".into(), "-c".into(), name], Duration::from_secs(30))
}

#[tauri::command]
pub fn git_history(limit: Option<usize>, state: State<'_, WorkspaceState>) -> Result<Vec<GitCommitSummary>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let result = run_bounded(
        &workspace_root(&state)?,
        "git",
        &["log".into(), format!("-{limit}"), "--date-order".into(), "--pretty=format:%H%x09%an%x09%at%x09%s".into()],
        Duration::from_secs(20),
    )?;
    if !result.ok { return Err(nonempty(&result.stderr, "Git history unavailable")); }
    Ok(result.stdout.lines().filter_map(|line| {
        let mut fields = line.splitn(4, '\t');
        Some(GitCommitSummary {
            sha: fields.next()?.to_string(),
            author: fields.next()?.to_string(),
            timestamp: fields.next()?.parse().ok()?,
            subject: fields.next().unwrap_or("").to_string(),
        })
    }).collect())
}

#[tauri::command]
pub fn git_clone_repository(url: String, parent: String, directory: Option<String>) -> Result<String, String> {
    validate_repository_url(&url)?;
    let parent = fs::canonicalize(parent).map_err(|error| format!("clone destination unavailable: {error}"))?;
    if !parent.is_dir() { return Err("clone destination must be a directory".into()); }
    let directory = directory.map(|value| validate_directory_name(&value).map(|_| value)).transpose()?;
    let mut args = vec!["clone".into(), "--".into(), url];
    if let Some(name) = &directory { args.push(name.clone()); }
    let result = run_bounded(&parent, "git", &args, Duration::from_secs(300))?;
    if !result.ok { return Err(nonempty(&result.stderr, "Git clone failed")); }
    let target = match directory {
        Some(name) => parent.join(name),
        None => infer_clone_target(&parent, &args[2])?,
    };
    Ok(fs::canonicalize(target).map_err(|error| format!("cloned repository unavailable: {error}"))?.to_string_lossy().to_string())
}

fn validate_ref_name(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 || value.starts_with('-') || value.contains("..") || value.contains("@{") || value.ends_with('.') || value.ends_with('/') || value.chars().any(|ch| ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')) {
        return Err("invalid Git branch name".into());
    }
    Ok(())
}

fn validate_repository_url(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.len() < 5 || value.len() > 4096 { return Err("invalid Git repository URL".into()); }
    let allowed = value.starts_with("https://") || value.starts_with("ssh://") || value.starts_with("git@") || value.starts_with("file://");
    if !allowed || value.contains('\n') || value.contains('\r') { return Err("Git repository URL must use HTTPS, SSH, or an explicit file URL".into()); }
    Ok(())
}

fn validate_directory_name(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 || value == "." || value == ".." || value.contains('/') || value.contains('\\') || value.chars().any(char::is_control) {
        return Err("invalid clone directory name".into());
    }
    Ok(())
}

fn infer_clone_target(parent: &Path, url: &str) -> Result<PathBuf, String> {
    let trimmed = url.trim_end_matches('/');
    let tail = trimmed.rsplit(['/', ':']).next().unwrap_or("").trim_end_matches(".git");
    validate_directory_name(tail)?;
    Ok(parent.join(tail))
}

fn nonempty(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
}
