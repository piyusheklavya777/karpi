// src-tauri/src/terminal.rs

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

static SESSION_COUNTER: AtomicU32 = AtomicU32::new(0);

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    // We keep the master to prevent it from being dropped
    #[allow(dead_code)]
    master: Box<dyn portable_pty::MasterPty + Send>,
}

pub struct TerminalState {
    sessions: Mutex<HashMap<u32, PtySession>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct TerminalOutput {
    session_id: u32,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct TerminalExit {
    session_id: u32,
    exit_code: Option<u32>,
}

/// Spawn a new PTY shell session
#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Get the user's default shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell for proper PATH

    // Set working directory
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    } else if let Some(home) = std::env::var("HOME").ok() {
        cmd.cwd(home);
    }

    // Set environment variables for better terminal experience
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let session_id = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);

    // Get reader for output
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    // Get writer for input
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store the session
    let state = app.state::<TerminalState>();
    {
        let mut sessions = state.sessions.lock();
        sessions.insert(
            session_id,
            PtySession {
                writer,
                master: pair.master,
            },
        );
    }

    // Spawn thread to read PTY output and emit to frontend
    let app_handle = app.clone();
    let sid = session_id;
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    // Convert to string, replacing invalid UTF-8
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: sid,
                            data,
                        },
                    );
                }
                Err(e) => {
                    log::error!("PTY read error: {}", e);
                    break;
                }
            }
        }

        // Wait for child to exit and emit exit event
        let exit_code = child.wait().ok().and_then(|s| {
            if s.success() {
                Some(0)
            } else {
                // portable_pty doesn't give us the actual exit code easily
                Some(1)
            }
        });

        let _ = app_handle.emit(
            "terminal-exit",
            TerminalExit {
                session_id: sid,
                exit_code,
            },
        );

        // Clean up session
        let state = app_handle.state::<TerminalState>();
        let mut sessions = state.sessions.lock();
        sessions.remove(&sid);
    });

    log::info!("Spawned terminal session {} with shell {}", session_id, shell);
    Ok(session_id)
}

/// Write data to a terminal session
#[tauri::command]
pub fn write_terminal(app: AppHandle, session_id: u32, data: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock();

    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to terminal: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush terminal: {}", e))?;
        Ok(())
    } else {
        Err(format!("Terminal session {} not found", session_id))
    }
}

/// Resize a terminal session
#[tauri::command]
pub fn resize_terminal(
    app: AppHandle,
    session_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let sessions = state.sessions.lock();

    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {}", e))?;
        Ok(())
    } else {
        Err(format!("Terminal session {} not found", session_id))
    }
}

/// Kill a terminal session
#[tauri::command]
pub fn kill_terminal(app: AppHandle, session_id: u32) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock();

    if sessions.remove(&session_id).is_some() {
        log::info!("Killed terminal session {}", session_id);
        Ok(())
    } else {
        Err(format!("Terminal session {} not found", session_id))
    }
}

/// List active terminal sessions
#[tauri::command]
pub fn list_terminals(app: AppHandle) -> Vec<u32> {
    let state = app.state::<TerminalState>();
    let sessions = state.sessions.lock();
    sessions.keys().cloned().collect()
}
