use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Default)]
struct AppState {
    config: Mutex<Config>,
    session_cookie: Mutex<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct Config {
    #[serde(rename = "apiBase")]
    api_base: Option<String>,
    #[serde(rename = "redmineBaseUrl")]
    redmine_base_url: Option<String>,
    #[serde(rename = "redmineApiKey")]
    redmine_api_key: Option<String>,
}

#[derive(Serialize)]
struct ApiResponse {
    #[serde(rename = "apiBase")]
    api_base: String,
    #[serde(rename = "redmineBaseUrl")]
    redmine_base_url: String,
    #[serde(rename = "redmineApiKey")]
    redmine_api_key: String,
}

#[derive(Default, Serialize)]
struct ConnectResult {
    ok: Option<bool>,
    error: Option<String>,
}

fn get_config(state: &AppState) -> Config {
    let config = state.config.lock().unwrap();
    config.clone()
}

#[tauri::command]
async fn get_config_cmd(state: tauri::State<'_, AppState>) -> Result<ApiResponse, String> {
    let config = get_config(&state);
    Ok(ApiResponse {
        api_base: config.api_base.unwrap_or_else(|| "http://100.110.136.4:3001".to_string()),
        redmine_base_url: config.redmine_base_url.unwrap_or_else(|| "https://redmine.nasctech.com".to_string()),
        redmine_api_key: config.redmine_api_key.unwrap_or_default(),
    })
}

#[tauri::command]
async fn save_config_cmd(
    new_config: Config,
    state: tauri::State<'_, AppState>,
) -> Result<ConnectResult, String> {
    // Save config
    {
        let mut config = state.config.lock().unwrap();
        *config = new_config.clone();
    }

    let config = get_config(&state);
    let api_base = config.api_base.clone().unwrap_or_else(|| "http://100.110.136.4:3001".to_string());
    let redmine_base_url = config.redmine_base_url.clone().unwrap_or_else(|| "https://redmine.nasctech.com".to_string());
    let redmine_api_key = config.redmine_api_key.clone().unwrap_or_default();

    if redmine_api_key.is_empty() {
        return Ok(ConnectResult {
            error: Some("No API key configured".to_string()),
            ..Default::default()
        });
    }

    // Connect to API
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/redmine/connect", api_base))
        .header("Content-Type", "application/json")
        .header("X-Redmine-API-Key", &redmine_api_key)
        .header("X-Redmine-Base-Url", &redmine_base_url)
        .json(&serde_json::json!({
            "baseUrl": redmine_base_url,
            "apiKey": redmine_api_key
        }))
        .send()
        .await;

    match response {
        Ok(res) => {
            // Try to capture session cookie
            if let Some(cookie) = res.headers().get("set-cookie") {
                if let Ok(c) = cookie.to_str() {
                    let session = c.split(';').next().unwrap_or("");
                    let mut sc = state.session_cookie.lock().unwrap();
                    *sc = session.to_string();
                }
            }
            
            match res.json::<serde_json::Value>().await {
                Ok(data) => Ok(ConnectResult {
                    ok: data.get("ok").and_then(|v| v.as_bool()),
                    error: data.get("error").and_then(|v| v.as_str()).map(|s| s.to_string()),
                }),
                Err(_) => Ok(ConnectResult::default())
            }
        }
        Err(e) => Ok(ConnectResult {
            error: Some(e.to_string()),
            ..Default::default()
        })
    }
}

#[tauri::command]
async fn fetch_issues_cmd(
    params: std::collections::HashMap<String, String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = get_config(&state);
    
    let api_base = config.api_base.clone().unwrap_or_else(|| "http://100.110.136.4:3001".to_string());
    let redmine_base_url = config.redmine_base_url.clone().unwrap_or_else(|| "https://redmine.nasctech.com".to_string());
    let redmine_api_key = config.redmine_api_key.clone().unwrap_or_default();

    // Extract session before async call
    let session = {
        let s = state.session_cookie.lock().unwrap();
        s.clone()
    };

    let client = reqwest::Client::new();
    let mut url = format!("{}/api/issues", api_base);
    
    if !params.is_empty() {
        let query: Vec<String> = params.iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        if !query.is_empty() {
            url = format!("{}?{}", url, query.join("&"));
        }
    }

    let mut request = client
        .get(&url)
        .header("X-Redmine-API-Key", &redmine_api_key)
        .header("X-Redmine-Base-Url", &redmine_base_url);

    if !session.is_empty() {
        request = request.header("Cookie", session.as_str());
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_status_cmd(
    issue_id: String,
    status_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = get_config(&state);
    
    let api_base = config.api_base.clone().unwrap_or_else(|| "http://100.110.136.4:3001".to_string());
    let redmine_base_url = config.redmine_base_url.clone().unwrap_or_else(|| "https://redmine.nasctech.com".to_string());
    let redmine_api_key = config.redmine_api_key.clone().unwrap_or_default();

    // Extract session before async call
    let session = {
        let s = state.session_cookie.lock().unwrap();
        s.clone()
    };

    let client = reqwest::Client::new();
    let mut request = client
        .post(format!("{}/api/issues/{}/status", api_base, issue_id))
        .header("Content-Type", "application/json")
        .header("X-Redmine-API-Key", &redmine_api_key)
        .header("X-Redmine-Base-Url", &redmine_base_url)
        .json(&serde_json::json!({ "statusId": status_id }));

    if !session.is_empty() {
        request = request.header("Cookie", session.as_str());
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_comment_cmd(
    issue_id: String,
    comment: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = get_config(&state);
    
    let api_base = config.api_base.clone().unwrap_or_else(|| "http://100.110.136.4:3001".to_string());
    let redmine_base_url = config.redmine_base_url.clone().unwrap_or_else(|| "https://redmine.nasctech.com".to_string());
    let redmine_api_key = config.redmine_api_key.clone().unwrap_or_default();

    // Extract session before async call
    let session = {
        let s = state.session_cookie.lock().unwrap();
        s.clone()
    };

    let client = reqwest::Client::new();
    let mut request = client
        .post(format!("{}/api/issues/{}/comment", api_base, issue_id))
        .header("Content-Type", "application/json")
        .header("X-Redmine-API-Key", &redmine_api_key)
        .header("X-Redmine-Base-Url", &redmine_base_url)
        .json(&serde_json::json!({ "comment": comment }));

    if !session.is_empty() {
        request = request.header("Cookie", session.as_str());
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    response.json().await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_config_cmd,
            save_config_cmd,
            fetch_issues_cmd,
            update_status_cmd,
            add_comment_cmd,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}