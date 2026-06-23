use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

struct TrayState(Mutex<tauri::tray::TrayIcon>);

fn png_to_image(bytes: &[u8]) -> Result<tauri::image::Image<'static>, String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => buf[..info.buffer_size()]
            .chunks(3)
            .flat_map(|c| [c[0], c[1], c[2], 255u8])
            .collect(),
        other => return Err(format!("unsupported PNG color type: {other:?}")),
    };
    Ok(tauri::image::Image::new_owned(rgba, info.width, info.height))
}

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

/// Update the system tray icon to reflect current overall status.
/// indicator: "none" → ok (green), "minor"/"maintenance" → warn (amber), anything else → down (red).
#[tauri::command]
fn update_tray_icon(app: AppHandle, indicator: String) -> Result<(), String> {
    let bytes: &'static [u8] = match indicator.to_lowercase().as_str() {
        "none" => include_bytes!("../icons/tray/tray-ok.png"),
        "minor" | "maintenance" => include_bytes!("../icons/tray/tray-warn.png"),
        _ => include_bytes!("../icons/tray/tray-down.png"),
    };
    let image = png_to_image(bytes)?;
    app.state::<TrayState>()
        .0
        .lock()
        .unwrap()
        .set_icon(Some(image))
        .map_err(|e| e.to_string())
}

/// Fetch URL body in Rust (follows redirects). Bypasses browser CORS for status APIs like AWS Health.
#[tauri::command]
async fn fetch_status_body(url: String) -> Result<Vec<u8>, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("User-Agent", "dev-status/1.0")
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
    .invoke_handler(tauri::generate_handler![get_config, save_config, fetch_status_body, update_tray_icon])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let tray_icon = png_to_image(include_bytes!("../icons/tray/tray-ok.png"))
        .expect("tray-ok.png must be bundled");
      let tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let is_visible = window.is_visible().unwrap_or(false);
                    if is_visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;
      app.manage(TrayState(Mutex::new(tray)));

      Ok(())
    })
    .on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            window.hide().unwrap();
            api.prevent_close();
        }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
