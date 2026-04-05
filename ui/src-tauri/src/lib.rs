// src-tauri/src/lib.rs

mod terminal;

use terminal::TerminalState;

/// Resolve `bun` binary — GUI apps on macOS don't inherit shell PATH
fn resolve_bun() -> String {
    let candidates = [
        "/opt/homebrew/bin/bun",   // Apple Silicon homebrew
        "/usr/local/bin/bun",      // Intel homebrew / manual install
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    // Fallback: check HOME/.bun/bin/bun
    if let Ok(home) = std::env::var("HOME") {
        let home_bun = format!("{}/.bun/bin/bun", home);
        if std::path::Path::new(&home_bun).exists() {
            return home_bun;
        }
    }
    "bun".to_string() // last resort — hope it's on PATH
}

#[tauri::command]
async fn run_karpi(args: Vec<String>) -> Result<String, String> {
    // Resolve the karpi project root (two levels up from src-tauri)
    let karpi_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .ok_or("Cannot resolve karpi project root")?;

    let entry = karpi_root.join("src").join("index.ts");
    let bun = resolve_bun();

    let output = tokio::process::Command::new(&bun)
        .arg("run")
        .arg(&entry)
        .arg("--json")
        .args(&args)
        .current_dir(karpi_root)
        .output()
        .await
        .map_err(|e| format!("Failed to run karpi (bun={}): {}", bun, e))?;

    let stdout = String::from_utf8(output.stdout)
        .unwrap_or_default()
        .trim()
        .to_string();
    let stderr = String::from_utf8(output.stderr)
        .unwrap_or_default()
        .trim()
        .to_string();

    if output.status.success() {
        Ok(stdout)
    } else if !stdout.is_empty() {
        // Some commands output JSON to stdout even on non-zero exit
        Ok(stdout)
    } else {
        Err(if stderr.is_empty() {
            "Command failed".to_string()
        } else {
            stderr
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            run_karpi,
            terminal::spawn_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            terminal::list_terminals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
