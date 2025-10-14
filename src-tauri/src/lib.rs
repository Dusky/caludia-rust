use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use futures::StreamExt;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiConfig {
    base_url: String,
    api_key: String,
    model: String,
    #[serde(default)]
    active_character_id: Option<String>,
    #[serde(default)]
    stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Character {
    id: String,
    name: String,
    avatar_path: Option<String>,
    system_prompt: String,
    greeting: Option<String>,
    personality: Option<String>,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatHistory {
    messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Serialize, Deserialize)]
struct ResponseMessage {
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Model {
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelsResponse {
    data: Vec<Model>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamChatRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamChoice {
    delta: Delta,
}

#[derive(Debug, Serialize, Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamResponse {
    choices: Vec<StreamChoice>,
}

fn get_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".config/claudia/config.json")
}

fn get_characters_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".config/claudia/characters")
}

fn get_character_path(character_id: &str) -> PathBuf {
    get_characters_dir().join(format!("{}.json", character_id))
}

fn get_character_history_path(character_id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(format!(".config/claudia/history_{}.json", character_id))
}

fn get_avatars_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".config/claudia/avatars")
}

fn get_avatar_path(filename: &str) -> PathBuf {
    get_avatars_dir().join(filename)
}

fn load_config() -> Option<ApiConfig> {
    let path = get_config_path();
    if let Ok(contents) = fs::read_to_string(path) {
        serde_json::from_str(&contents).ok()
    } else {
        None
    }
}

fn save_config(config: &ApiConfig) -> Result<(), String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_history(character_id: &str) -> ChatHistory {
    let path = get_character_history_path(character_id);
    if let Ok(contents) = fs::read_to_string(path) {
        serde_json::from_str(&contents).unwrap_or(ChatHistory { messages: vec![] })
    } else {
        ChatHistory { messages: vec![] }
    }
}

fn save_history(character_id: &str, history: &ChatHistory) -> Result<(), String> {
    let path = get_character_history_path(character_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_character(character_id: &str) -> Option<Character> {
    let path = get_character_path(character_id);
    if let Ok(contents) = fs::read_to_string(path) {
        serde_json::from_str(&contents).ok()
    } else {
        None
    }
}

fn save_character(character: &Character) -> Result<(), String> {
    let dir = get_characters_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = get_character_path(&character.id);
    let contents = serde_json::to_string_pretty(character).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

fn create_default_character() -> Character {
    Character {
        id: "default".to_string(),
        name: "Assistant".to_string(),
        avatar_path: None,
        system_prompt: "You are a helpful AI assistant. Be friendly, concise, and informative.".to_string(),
        greeting: Some("Hello! How can I help you today?".to_string()),
        personality: Some("helpful, friendly, knowledgeable".to_string()),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    }
}

fn get_active_character() -> Character {
    // Try to load active character from config
    if let Some(config) = load_config() {
        if let Some(character_id) = config.active_character_id {
            if let Some(character) = load_character(&character_id) {
                return character;
            }
        }
    }

    // Try to load default character
    if let Some(character) = load_character("default") {
        return character;
    }

    // Create and save default character
    let character = create_default_character();
    save_character(&character).ok();
    character
}

#[tauri::command]
fn get_character() -> Result<Character, String> {
    Ok(get_active_character())
}

#[tauri::command]
fn update_character(
    name: String,
    system_prompt: String,
    greeting: Option<String>,
    personality: Option<String>,
    avatar_path: Option<String>,
) -> Result<(), String> {
    let mut character = get_active_character();
    character.name = name;
    character.system_prompt = system_prompt;
    character.greeting = greeting;
    character.personality = personality;
    character.avatar_path = avatar_path;
    save_character(&character)
}

#[tauri::command]
fn upload_avatar(source_path: String, character_id: String) -> Result<String, String> {
    // Create avatars directory if it doesn't exist
    let avatars_dir = get_avatars_dir();
    fs::create_dir_all(&avatars_dir).map_err(|e| e.to_string())?;

    // Get file extension
    let source = PathBuf::from(&source_path);
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file extension".to_string())?;

    // Create unique filename: character_id + extension
    let filename = format!("{}.{}", character_id, extension);
    let dest_path = get_avatar_path(&filename);

    // Copy file
    fs::copy(&source, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    Ok(filename)
}

#[tauri::command]
async fn select_and_upload_avatar(app_handle: tauri::AppHandle, character_id: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file dialog
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        // Upload the selected file
        let path_str = path.as_path()
            .ok_or_else(|| "Could not get file path".to_string())?
            .to_string_lossy()
            .to_string();
        upload_avatar(path_str, character_id)
    } else {
        Err("No file selected".to_string())
    }
}

#[tauri::command]
fn get_avatar_full_path(avatar_filename: String) -> Result<String, String> {
    let path = get_avatar_path(&avatar_filename);
    if path.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Avatar file not found".to_string())
    }
}

#[tauri::command]
async fn validate_api(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let base = base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };

    let response = client
        .get(&url)
        .header("authorization", format!("Bearer {}", &api_key))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned status: {}", response.status()));
    }

    let models: ModelsResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    Ok(models.data.into_iter().map(|m| m.id).collect())
}

#[tauri::command]
async fn save_api_config(base_url: String, api_key: String, model: String, stream: bool) -> Result<(), String> {
    // Preserve existing active_character_id if it exists
    let active_character_id = load_config().and_then(|c| c.active_character_id);

    let config = ApiConfig {
        base_url,
        api_key,
        model,
        active_character_id,
        stream,
    };
    save_config(&config)
}

#[tauri::command]
fn get_api_config() -> Result<ApiConfig, String> {
    println!("Getting API config...");
    load_config().ok_or_else(|| "No config found".to_string())
}

#[tauri::command]
async fn chat(message: String) -> Result<String, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let mut history = load_history(&character.id);

    // Add user message to history
    history.messages.push(Message {
        role: "user".to_string(),
        content: message.clone(),
    });

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first
    let mut api_messages = vec![Message {
        role: "system".to_string(),
        content: character.system_prompt.clone(),
    }];
    api_messages.extend(history.messages.clone());

    let request = ChatRequest {
        model: config.model.clone(),
        max_tokens: 4096,
        messages: api_messages,
    };

    let response = client
        .post(&url)
        .header("authorization", format!("Bearer {}", &config.api_key))
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let assistant_message = chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "No response content".to_string())?;

    // Add assistant message to history
    history.messages.push(Message {
        role: "assistant".to_string(),
        content: assistant_message.clone(),
    });

    // Save history
    save_history(&character.id, &history).ok();

    Ok(assistant_message)
}

#[tauri::command]
async fn chat_stream(app_handle: tauri::AppHandle, message: String) -> Result<String, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let mut history = load_history(&character.id);

    // Add user message to history
    history.messages.push(Message {
        role: "user".to_string(),
        content: message.clone(),
    });

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first
    let mut api_messages = vec![Message {
        role: "system".to_string(),
        content: character.system_prompt.clone(),
    }];
    api_messages.extend(history.messages.clone());

    let request = StreamChatRequest {
        model: config.model.clone(),
        max_tokens: 4096,
        messages: api_messages,
        stream: true,
    };

    let response = client
        .post(&url)
        .header("authorization", format!("Bearer {}", &config.api_key))
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    // Process streaming response
    let mut full_content = String::new();
    let mut stream = response.bytes_stream();

    let mut buffer = String::new();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            // Parse SSE data lines
            if line.starts_with("data: ") {
                let data = &line[6..];

                // Check for stream end
                if data == "[DONE]" {
                    break;
                }

                // Parse JSON and extract content
                if let Ok(stream_response) = serde_json::from_str::<StreamResponse>(data) {
                    if let Some(choice) = stream_response.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            full_content.push_str(content);

                            // Emit token to frontend
                            let _ = app_handle.emit_to("main", "chat-token", content.clone());
                        }
                    }
                }
            }
        }
    }

    // Add assistant message to history
    history.messages.push(Message {
        role: "assistant".to_string(),
        content: full_content.clone(),
    });

    // Save history
    save_history(&character.id, &history).ok();

    // Emit completion event
    let _ = app_handle.emit_to("main", "chat-complete", ());

    Ok(full_content)
}

#[tauri::command]
fn get_chat_history() -> Result<Vec<Message>, String> {
    let character = get_active_character();
    Ok(load_history(&character.id).messages)
}

#[tauri::command]
fn clear_chat_history() -> Result<(), String> {
    let character = get_active_character();
    let history = ChatHistory { messages: vec![] };
    save_history(&character.id, &history)
}

#[tauri::command]
fn create_character(name: String, system_prompt: String) -> Result<Character, String> {
    let new_id = Uuid::new_v4().to_string();
    let character = Character {
        id: new_id.clone(),
        name: name.clone(),
        avatar_path: None,
        system_prompt,
        greeting: Some(format!("Hello, I'm {}. How can I help you?", name)),
        personality: None,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    };
    save_character(&character)?;
    set_active_character(new_id)?;
    Ok(character)
}

#[tauri::command]
fn delete_character(character_id: String) -> Result<(), String> {
    if character_id == "default" {
        return Err("Cannot delete the default character.".to_string());
    }

    // Get character to check for avatar
    if let Some(character) = load_character(&character_id) {
        // Remove avatar if it exists
        if let Some(avatar_filename) = character.avatar_path {
            let avatar_path = get_avatar_path(&avatar_filename);
            if avatar_path.exists() {
                fs::remove_file(avatar_path).ok();
            }
        }
    }

    // Remove character file
    let path = get_character_path(&character_id);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    // Remove history file
    let history_path = get_character_history_path(&character_id);
    if history_path.exists() {
        fs::remove_file(history_path).map_err(|e| e.to_string())?;
    }

    // If the deleted character was active, switch to default
    if let Some(config) = load_config() {
        if config.active_character_id == Some(character_id) {
            set_active_character("default".to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn list_characters() -> Result<Vec<Character>, String> {
    println!("Listing characters...");
    let dir = get_characters_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut characters = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Some(character) = load_character(path.file_stem().unwrap().to_str().unwrap()) {
                characters.push(character);
            }
        }
    }
    println!("Found {} characters", characters.len());
    Ok(characters)
}

#[tauri::command]
fn set_active_character(character_id: String) -> Result<(), String> {
    if let Some(mut config) = load_config() {
        config.active_character_id = Some(character_id);
        save_config(&config)
    } else {
        Err("API config not found. Please configure API first.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chat,
            chat_stream,
            validate_api,
            save_api_config,
            get_api_config,
            get_chat_history,
            clear_chat_history,
            get_character,
            update_character,
            upload_avatar,
            select_and_upload_avatar,
            get_avatar_full_path,
            list_characters,
            create_character,
            delete_character,
            set_active_character
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
