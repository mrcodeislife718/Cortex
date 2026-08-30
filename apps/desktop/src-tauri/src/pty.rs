use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::State;

use crate::{workspace_root, WorkspaceState};

static PTY_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_BUFFER_BYTES: usize = 4 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 128 * 1024;

pub struct PtyHost {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}
impl Default for PtyHost { fn default() -> Self { Self { sessions: Mutex::new(HashMap::new()) } } }

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    output: Arc<Mutex<OutputBuffer>>,
}

#[derive(Default)]
struct OutputBuffer {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
}

#[derive(Serialize)]
pub struct PtySessionInfo {
    id: String,
    #[serde(rename = "processId")]
    process_id: Option<u32>,
    rows: u16,
    cols: u16,
}

#[tauri::command]
pub fn pty_start(rows: Option<u16>, cols: Option<u16>, workspace: State<'_, WorkspaceState>, host: State<'_, PtyHost>) -> Result<PtySessionInfo, String> {
    let root = workspace_root(&workspace)?;
    let rows = rows.unwrap_or(30).clamp(2, 500);
    let cols = cols.unwrap_or(100).clamp(10, 1_000);
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|error| format!("PTY allocation failed: {error}"))?;
    let mut command = CommandBuilder::new_default_prog();
    command.cwd(&root);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("CORTEX_IDE", "1");
    let child = pair.slave.spawn_command(command).map_err(|error| format!("shell start failed: {error}"))?;
    drop(pair.slave);
    let process_id = child.process_id();
    let reader = pair.master.try_clone_reader().map_err(|error| format!("PTY reader unavailable: {error}"))?;
    let writer = pair.master.take_writer().map_err(|error| format!("PTY writer unavailable: {error}"))?;
    let output = Arc::new(Mutex::new(OutputBuffer::default()));
    spawn_reader(reader, Arc::clone(&output));
    let id = format!("pty-{}", PTY_COUNTER.fetch_add(1, Ordering::Relaxed));
    let session = Arc::new(PtySession { master: Mutex::new(pair.master), writer: Mutex::new(writer), child: Mutex::new(child), output });
    host.sessions.lock().map_err(|_| "PTY host poisoned")?.insert(id.clone(), session);
    Ok(PtySessionInfo { id, process_id, rows, cols })
}

#[tauri::command]
pub fn pty_write(id: String, data: String, host: State<'_, PtyHost>) -> Result<(), String> {
    if data.len() > MAX_WRITE_BYTES { return Err("PTY write exceeds Cortex limit".into()); }
    let session = get_session(&host, &id)?;
    let mut writer = session.writer.lock().map_err(|_| "PTY writer poisoned")?;
    writer.write_all(data.as_bytes()).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pty_read(id: String, max_bytes: Option<usize>, host: State<'_, PtyHost>) -> Result<String, String> {
    let session = get_session(&host, &id)?;
    let mut output = session.output.lock().map_err(|_| "PTY output poisoned")?;
    let limit = max_bytes.unwrap_or(256 * 1024).clamp(1, 1024 * 1024);
    let mut collected = Vec::with_capacity(limit.min(output.bytes));
    while collected.len() < limit {
        let Some(mut chunk) = output.chunks.pop_front() else { break; };
        output.bytes = output.bytes.saturating_sub(chunk.len());
        let remaining = limit - collected.len();
        if chunk.len() > remaining {
            let rest = chunk.split_off(remaining);
            output.bytes += rest.len();
            output.chunks.push_front(rest);
        }
        collected.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&collected).to_string())
}

#[tauri::command]
pub fn pty_resize(id: String, rows: u16, cols: u16, host: State<'_, PtyHost>) -> Result<(), String> {
    let session = get_session(&host, &id)?;
    let master = session.master.lock().map_err(|_| "PTY master poisoned")?;
    master.resize(PtySize {
        rows: rows.clamp(2, 500),
        cols: cols.clamp(10, 1_000),
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pty_stop(id: String, host: State<'_, PtyHost>) -> Result<(), String> {
    let session = host.sessions.lock().map_err(|_| "PTY host poisoned")?.remove(&id).ok_or("unknown PTY session")?;
    let mut child = session.child.lock().map_err(|_| "PTY child poisoned")?;
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

fn get_session(host: &State<'_, PtyHost>, id: &str) -> Result<Arc<PtySession>, String> {
    if id.trim().is_empty() { return Err("PTY session id is required".into()); }
    host.sessions.lock().map_err(|_| "PTY host poisoned")?.get(id).cloned().ok_or_else(|| "unknown PTY session".into())
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, output: Arc<Mutex<OutputBuffer>>) {
    thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut output) = output.lock() {
                        let chunk = buffer[..read].to_vec();
                        output.bytes += chunk.len();
                        output.chunks.push_back(chunk);
                        while output.bytes > MAX_BUFFER_BYTES {
                            if let Some(front) = output.chunks.pop_front() { output.bytes = output.bytes.saturating_sub(front.len()); } else { break; }
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
}
