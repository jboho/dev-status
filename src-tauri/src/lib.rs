use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Repairs known-broken service entries from older configs.
// Returns (possibly-modified json, whether a change was made).
fn migrate_config(raw: &str) -> (String, bool) {
    let mut config: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return (raw.to_string(), false),
    };
    let mut changed = false;
    if let Some(services) = config["services"].as_array_mut() {
        let before = services.len();
        // Redis has no public JSON API (HTML SPA). Anthropic folded into Claude feed.
        services.retain(|s| s["name"] != "Redis" && s["name"] != "Anthropic");
        changed |= services.len() != before;
        // Linear migrated from status.linear.app to linearstatus.com.
        for s in services.iter_mut() {
            if s["name"] == "Linear" && s["url"] == "https://status.linear.app/api/v2/summary.json" {
                s["url"] = serde_json::Value::String("https://linearstatus.com/api/v2/summary.json".into());
                changed = true;
            }
        }
    }
    if changed {
        (serde_json::to_string(&config).unwrap_or_else(|_| raw.to_string()), true)
    } else {
        (raw.to_string(), false)
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> Result<String, String> {
    let config_path = get_config_path(&app)?;
    if !config_path.exists() {
        let default_config = r#"{
  "services": [
    {
      "name": "GitHub",
      "url": "https://www.githubstatus.com/api/v2/summary.json"
    },
    {
      "name": "Vercel",
      "url": "https://www.vercel-status.com/api/v2/summary.json"
    },
    {
      "name": "Claude",
      "url": "https://status.claude.com/api/v2/summary.json"
    },
    {
      "name": "Cursor",
      "url": "https://status.cursor.com/api/v2/summary.json"
    },
    {
      "name": "OpenAI",
      "url": "https://status.openai.com/api/v2/summary.json"
    },
    {
      "name": "AWS",
      "url": "https://status.aws.amazon.com/data.json"
    },
    {
      "name": "Netlify",
      "url": "https://www.netlifystatus.com/api/v2/summary.json"
    },
    {
      "name": "npm",
      "url": "https://status.npmjs.org/api/v2/summary.json"
    },
    {
      "name": "Figma",
      "url": "https://status.figma.com/api/v2/summary.json"
    },
    {
      "name": "Cloudflare",
      "url": "https://www.cloudflarestatus.com/api/v2/summary.json"
    },
    {
      "name": "Stripe",
      "url": "https://www.stripestatus.com/api/v2/summary.json"
    },
    {
      "name": "Supabase",
      "url": "https://status.supabase.com/api/v2/summary.json"
    },
    {
      "name": "Twilio",
      "url": "https://status.twilio.com/api/v2/summary.json"
    },
    {
      "name": "MongoDB Atlas",
      "url": "https://status.mongodb.com/api/v2/summary.json"
    },
    {
      "name": "Datadog",
      "url": "https://status.datadoghq.com/api/v2/summary.json"
    },
    {
      "name": "Linear",
      "url": "https://linearstatus.com/api/v2/summary.json"
    },
    {
      "name": "Notion",
      "url": "https://www.notion-status.com/api/v2/summary.json"
    }
  ]
}"#;
        fs::write(&config_path, default_config).map_err(|e| e.to_string())?;
        return Ok(default_config.to_string());
    }
    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let (migrated, changed) = migrate_config(&raw);
    if changed {
        let _ = fs::write(&config_path, &migrated);
    }
    Ok(migrated)
}

#[tauri::command]
fn save_config(app: AppHandle, config: String) -> Result<(), String> {
    let config_path = get_config_path(&app)?;
    fs::write(config_path, config).map_err(|e| e.to_string())
}

/// Fetch URL body in Rust (follows redirects). Bypasses browser CORS for status APIs like AWS Health.
#[tauri::command]
async fn fetch_status_body(url: String) -> Result<Vec<u8>, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("User-Agent", "DevStatus/1.0")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())
        .map(|b| b.to_vec())
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    path.push("config.json");
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![get_config, save_config, fetch_status_body])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      Ok(())
    })
    .on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            window.hide().unwrap();
            api.prevent_close();
        }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
        // Dock-only app: the close button hides the window (prevent_close above),
        // so clicking the dock icon must re-show it. Reopen (macOS-only event) fires on that click.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
