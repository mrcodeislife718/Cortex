use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MAX_SESSION_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub fn save_workspace_session(app: AppHandle, session: Value) -> Result<(), String> {
    validate_session(&session)?;
    let bytes = serde_json::to_vec(&session).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SESSION_BYTES { return Err("Cortex recovery session exceeds 20 MiB".into()); }
    let target = session_path(&app)?;
    if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let temp = target.with_extension("json.tmp");
    write_private(&temp, &bytes)?;
    fs::rename(&temp, &target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_workspace_session(app: AppHandle) -> Result<Option<Value>, String> {
    let target = session_path(&app)?;
    if !target.is_file() { return Ok(None); }
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if metadata.len() as usize > MAX_SESSION_BYTES { return Err("Cortex recovery session is oversized".into()); }
    let bytes = fs::read(target).map_err(|error| error.to_string())?;
    let session: Value = serde_json::from_slice(&bytes).map_err(|error| format!("Cortex recovery session is corrupt: {error}"))?;
    validate_session(&session)?;
    Ok(Some(session))
}

#[tauri::command]
pub fn clear_workspace_session(app: AppHandle) -> Result<(), String> {
    let target = session_path(&app)?;
    match fs::remove_file(target) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(error.to_string()) }
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("recovery").join("workbench-session.json"))
}

fn validate_session(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid Cortex recovery session")?;
    if let Some(workspace) = object.get("workspace") {
        if !workspace.is_null() && !workspace.is_string() { return Err("invalid recovery workspace".into()); }
    }
    if let Some(editors) = object.get("openEditors") {
        let editors = editors.as_array().ok_or("invalid recovery editor list")?;
        if editors.len() > 256 || editors.iter().any(|value| value.as_str().map_or(true, |text| text.len() > 4096)) { return Err("invalid recovery editor list".into()); }
    }
    if let Some(buffers) = object.get("unsavedBuffers") {
        let buffers = buffers.as_array().ok_or("invalid recovery buffers")?;
        if buffers.len() > 128 { return Err("too many recovery buffers".into()); }
    }
    Ok(())
}

fn write_private(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        use std::io::Write;
        let mut file = fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(path).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes).map_err(|error| error.to_string())
    }
}
