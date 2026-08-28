use serde::Serialize;

#[derive(Serialize)]
struct RuntimeInfo {
    name: &'static str,
    version: &'static str,
    architecture: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        name: "Cortex",
        version: env!("CARGO_PKG_VERSION"),
        architecture: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_info])
        .run(tauri::generate_context!())
        .expect("failed to run Cortex desktop runtime");
}
