use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct PendingUpdate(pub Mutex<Option<Update>>);

impl Default for PendingUpdate {
    fn default() -> Self { Self(Mutex::new(None)) }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let update = app
        .updater()
        .map_err(|error| format!("updater configuration unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("update check failed: {error}"))?;

    let metadata = update.as_ref().map(|candidate| UpdateMetadata {
        version: candidate.version.clone(),
        current_version: candidate.current_version.clone(),
        notes: candidate.body.clone(),
    });

    *pending_update.0.lock().map_err(|_| "update state poisoned")? = update;
    Ok(metadata)
}

#[tauri::command]
pub async fn install_pending_update(
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|_| "update state poisoned")?
        .take()
        .ok_or_else(|| "no verified Cortex update is pending".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("update installation failed: {error}"))?;
    Ok(())
}
