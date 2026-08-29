use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;

use crate::{workspace_root, WorkspaceState};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_NOTIFICATIONS: usize = 2_000;

pub struct ProtocolHost {
    sessions: Mutex<HashMap<String, ProtocolSession>>,
}

impl Default for ProtocolHost {
    fn default() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }
}

struct ProtocolSession {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, SyncSender<Value>>>>,
    notifications: Arc<Mutex<VecDeque<Value>>>,
    next_request: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionInfo {
    session_id: String,
    pid: u32,
    program: String,
}

#[tauri::command]
pub fn protocol_start(
    program: String,
    args: Vec<String>,
    workspace: State<'_, WorkspaceState>,
    host: State<'_, ProtocolHost>,
) -> Result<ProtocolSessionInfo, String> {
    validate_executable(&program)?;
    if args.len() > 128 || args.iter().any(|arg| arg.len() > 8192) { return Err("protocol arguments exceed Cortex limits".into()); }
    let root = workspace_root(&workspace)?;
    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {program}: {error}"))?;
    let pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("protocol stdin unavailable")?));
    let stdout = child.stdout.take().ok_or("protocol stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("protocol stderr unavailable")?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let notifications = Arc::new(Mutex::new(VecDeque::new()));
    spawn_stdout_reader(stdout, Arc::clone(&pending), Arc::clone(&notifications));
    spawn_stderr_reader(stderr, Arc::clone(&notifications));
    let session_id = format!("protocol-{}", SESSION_COUNTER.fetch_add(1, Ordering::Relaxed));
    let session = ProtocolSession { child, stdin, pending, notifications, next_request: AtomicU64::new(1) };
    host.sessions.lock().map_err(|_| "protocol host poisoned")?.insert(session_id.clone(), session);
    Ok(ProtocolSessionInfo { session_id, pid, program })
}

#[tauri::command]
pub fn lsp_request(
    session_id: String,
    method: String,
    params: Value,
    timeout_ms: Option<u64>,
    host: State<'_, ProtocolHost>,
) -> Result<Value, String> {
    if method.trim().is_empty() || method.len() > 256 { return Err("invalid LSP method".into()); }
    with_session(&host, &session_id, |session| {
        let id = session.next_request.fetch_add(1, Ordering::Relaxed);
        let key = format!("lsp:{id}");
        let payload = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
        send_and_wait(session, key, payload, timeout_ms.unwrap_or(15_000))
    })
}

#[tauri::command]
pub fn lsp_notify(session_id: String, method: String, params: Value, host: State<'_, ProtocolHost>) -> Result<(), String> {
    if method.trim().is_empty() || method.len() > 256 { return Err("invalid LSP method".into()); }
    with_session(&host, &session_id, |session| write_message(&session.stdin, &json!({"jsonrpc":"2.0","method":method,"params":params})))
}

#[tauri::command]
pub fn dap_request(
    session_id: String,
    command: String,
    arguments: Value,
    timeout_ms: Option<u64>,
    host: State<'_, ProtocolHost>,
) -> Result<Value, String> {
    if command.trim().is_empty() || command.len() > 128 { return Err("invalid DAP command".into()); }
    with_session(&host, &session_id, |session| {
        let seq = session.next_request.fetch_add(1, Ordering::Relaxed);
        let key = format!("dap:{seq}");
        let payload = json!({"seq":seq,"type":"request","command":command,"arguments":arguments});
        send_and_wait(session, key, payload, timeout_ms.unwrap_or(30_000))
    })
}

#[tauri::command]
pub fn dap_notify(session_id: String, event: String, body: Value, host: State<'_, ProtocolHost>) -> Result<(), String> {
    if event.trim().is_empty() || event.len() > 128 { return Err("invalid DAP event".into()); }
    with_session(&host, &session_id, |session| {
        let seq = session.next_request.fetch_add(1, Ordering::Relaxed);
        write_message(&session.stdin, &json!({"seq":seq,"type":"event","event":event,"body":body}))
    })
}

#[tauri::command]
pub fn protocol_take_notifications(session_id: String, limit: Option<usize>, host: State<'_, ProtocolHost>) -> Result<Vec<Value>, String> {
    with_session(&host, &session_id, |session| {
        let mut queue = session.notifications.lock().map_err(|_| "protocol notification queue poisoned")?;
        let count = limit.unwrap_or(100).min(500).min(queue.len());
        Ok((0..count).filter_map(|_| queue.pop_front()).collect())
    })
}

#[tauri::command]
pub fn protocol_stop(session_id: String, host: State<'_, ProtocolHost>) -> Result<(), String> {
    let mut session = host.sessions.lock().map_err(|_| "protocol host poisoned")?.remove(&session_id).ok_or("unknown protocol session")?;
    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(())
}

fn with_session<T>(host: &State<'_, ProtocolHost>, session_id: &str, operation: impl FnOnce(&ProtocolSession) -> Result<T, String>) -> Result<T, String> {
    if session_id.trim().is_empty() { return Err("protocol session id is required".into()); }
    let sessions = host.sessions.lock().map_err(|_| "protocol host poisoned")?;
    let session = sessions.get(session_id).ok_or("unknown protocol session")?;
    operation(session)
}

fn send_and_wait(session: &ProtocolSession, key: String, payload: Value, timeout_ms: u64) -> Result<Value, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    session.pending.lock().map_err(|_| "protocol pending map poisoned")?.insert(key.clone(), tx);
    if let Err(error) = write_message(&session.stdin, &payload) {
        let _ = session.pending.lock().map(|mut pending| pending.remove(&key));
        return Err(error);
    }
    match rx.recv_timeout(Duration::from_millis(timeout_ms.clamp(100, 120_000))) {
        Ok(value) => Ok(value),
        Err(_) => {
            let _ = session.pending.lock().map(|mut pending| pending.remove(&key));
            Err("protocol request timed out".into())
        }
    }
}

fn write_message(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_MESSAGE_BYTES { return Err("protocol message exceeds Cortex limit".into()); }
    let mut writer = stdin.lock().map_err(|_| "protocol stdin poisoned")?;
    write!(writer, "Content-Length: {}\r\n\r\n", bytes.len()).map_err(|error| error.to_string())?;
    writer.write_all(&bytes).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn spawn_stdout_reader(stdout: impl Read + Send + 'static, pending: Arc<Mutex<HashMap<String, SyncSender<Value>>>>, notifications: Arc<Mutex<VecDeque<Value>>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_message(&mut reader) {
                Ok(Some(value)) => dispatch_message(value, &pending, &notifications),
                Ok(None) => break,
                Err(error) => { push_notification(&notifications, json!({"cortexProtocolError":error})); break; }
            }
        }
    });
}

fn spawn_stderr_reader(stderr: impl Read + Send + 'static, notifications: Arc<Mutex<VecDeque<Value>>>) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if !line.trim().is_empty() { push_notification(&notifications, json!({"cortexProtocolStderr":line})); }
        }
    });
}

fn read_message(reader: &mut BufReader<impl Read>) -> Result<Option<Value>, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|error| error.to_string())?;
        if read == 0 { return Ok(None); }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() { break; }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") { content_length = Some(value.trim().parse::<usize>().map_err(|_| "invalid protocol content length")?); }
        }
    }
    let length = content_length.ok_or("protocol message missing Content-Length")?;
    if length > MAX_MESSAGE_BYTES { return Err("protocol message exceeds Cortex limit".into()); }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map(Some).map_err(|error| format!("invalid protocol JSON: {error}"))
}

fn dispatch_message(value: Value, pending: &Arc<Mutex<HashMap<String, SyncSender<Value>>>>, notifications: &Arc<Mutex<VecDeque<Value>>>) {
    let key = if let Some(id) = value.get("id") { Some(format!("lsp:{}", normalize_id(id))) }
    else if let Some(seq) = value.get("request_seq") { Some(format!("dap:{}", normalize_id(seq))) }
    else { None };
    if let Some(key) = key {
        if let Ok(mut map) = pending.lock() {
            if let Some(sender) = map.remove(&key) { let _ = sender.send(value); return; }
        }
    }
    push_notification(notifications, value);
}

fn push_notification(queue: &Arc<Mutex<VecDeque<Value>>>, value: Value) {
    if let Ok(mut queue) = queue.lock() {
        while queue.len() >= MAX_NOTIFICATIONS { queue.pop_front(); }
        queue.push_back(value);
    }
}

fn normalize_id(value: &Value) -> String {
    value.as_u64().map(|value| value.to_string()).or_else(|| value.as_str().map(ToOwned::to_owned)).unwrap_or_else(|| value.to_string())
}

fn validate_executable(program: &str) -> Result<(), String> {
    if program.trim().is_empty() || program.len() > 256 { return Err("invalid protocol executable".into()); }
    if program.contains('/') || program.contains('\\') || program.chars().any(|ch| ch.is_control()) { return Err("protocol executable must be a PATH-resolved program name".into()); }
    Ok(())
}
