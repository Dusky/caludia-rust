use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::io::BufWriter;
use uuid::Uuid;
use futures::StreamExt;
use tauri::Emitter;
use base64::Engine;

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

    // V2 character card fields
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    scenario: Option<String>,
    #[serde(default)]
    mes_example: Option<String>,
    #[serde(default)]
    post_history_instructions: Option<String>,
    #[serde(default)]
    alternate_greetings: Vec<String>,
    #[serde(default)]
    character_book: Option<serde_json::Value>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    creator: Option<String>,
    #[serde(default)]
    character_version: Option<String>,
    #[serde(default)]
    creator_notes: Option<String>,
    #[serde(default)]
    extensions: serde_json::Value,
}

// V2/V3 character card specification structs
#[derive(Debug, Serialize, Deserialize)]
struct CharacterCardV2 {
    spec: String,
    spec_version: String,
    data: CharacterCardV2Data,
}

// V3 card format (fields at top level + data object)
#[derive(Debug, Serialize, Deserialize)]
struct CharacterCardV3 {
    spec: String,
    spec_version: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    personality: Option<String>,
    #[serde(default)]
    scenario: Option<String>,
    #[serde(default)]
    first_mes: Option<String>,
    #[serde(default)]
    mes_example: Option<String>,
    #[serde(default)]
    data: serde_json::Value,  // V3 has additional data nested here
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    extensions: serde_json::Value,
}

impl From<CharacterCardV3> for CharacterCardV2Data {
    fn from(v3: CharacterCardV3) -> Self {
        Self {
            name: v3.name,
            description: v3.description,
            personality: v3.personality,
            scenario: v3.scenario,
            first_mes: v3.first_mes,
            mes_example: v3.mes_example,
            system_prompt: v3.data.get("system_prompt").and_then(|v| v.as_str()).map(String::from),
            post_history_instructions: v3.data.get("post_history_instructions").and_then(|v| v.as_str()).map(String::from),
            alternate_greetings: v3.data.get("alternate_greetings")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            character_book: v3.data.get("character_book").cloned(),
            tags: v3.tags,
            creator: v3.data.get("creator").and_then(|v| v.as_str()).map(String::from),
            character_version: v3.data.get("character_version").and_then(|v| v.as_str()).map(String::from),
            creator_notes: v3.data.get("creator_notes").and_then(|v| v.as_str()).map(String::from),
            extensions: v3.extensions,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct CharacterCardV2Data {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scenario: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_mes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mes_example: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    post_history_instructions: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    alternate_greetings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    character_book: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    creator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    character_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    creator_notes: Option<String>,
    #[serde(default)]
    extensions: serde_json::Value,
}

impl From<Character> for CharacterCardV2Data {
    fn from(character: Character) -> Self {
        Self {
            name: character.name,
            description: character.description,
            personality: character.personality,
            scenario: character.scenario,
            first_mes: character.greeting,
            mes_example: character.mes_example,
            system_prompt: Some(character.system_prompt),
            post_history_instructions: character.post_history_instructions,
            alternate_greetings: character.alternate_greetings,
            character_book: character.character_book,
            tags: character.tags,
            creator: character.creator,
            character_version: character.character_version,
            creator_notes: character.creator_notes,
            extensions: character.extensions,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Message {
    role: String,
    #[serde(default)]
    content: String, // Keep for backward compatibility
    #[serde(default)]
    swipes: Vec<String>,
    #[serde(default)]
    current_swipe: usize,
    #[serde(default)]
    timestamp: i64, // Unix timestamp in milliseconds
}

impl Message {
    fn new_user(content: String) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        Self {
            role: "user".to_string(),
            content: content.clone(),
            swipes: vec![content],
            current_swipe: 0,
            timestamp,
        }
    }

    fn new_assistant(content: String) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        Self {
            role: "assistant".to_string(),
            content: content.clone(),
            swipes: vec![content],
            current_swipe: 0,
            timestamp,
        }
    }

    fn get_content(&self) -> &str {
        if !self.swipes.is_empty() {
            &self.swipes[self.current_swipe]
        } else {
            &self.content
        }
    }

    fn add_swipe(&mut self, content: String) {
        self.swipes.push(content.clone());
        self.current_swipe = self.swipes.len() - 1;
        self.content = content;
    }

    fn set_swipe(&mut self, index: usize) -> Result<(), String> {
        if index >= self.swipes.len() {
            return Err("Invalid swipe index".to_string());
        }
        self.current_swipe = index;
        self.content = self.swipes[index].clone();
        Ok(())
    }

    // Migrate old format to new format
    fn migrate(&mut self) {
        if self.swipes.is_empty() && !self.content.is_empty() {
            self.swipes = vec![self.content.clone()];
            self.current_swipe = 0;
        }
    }
}

// World Info / Lorebook Entry
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorldInfoEntry {
    id: String,
    keys: Vec<String>, // Keywords that trigger this entry
    content: String, // The content to inject
    enabled: bool,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    priority: i32, // Higher priority entries are injected first
}

// Roleplay Settings (Author's Note, Persona, World Info)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RoleplaySettings {
    #[serde(default)]
    authors_note: Option<String>,
    #[serde(default)]
    authors_note_enabled: bool,
    #[serde(default)]
    persona_name: Option<String>,
    #[serde(default)]
    persona_description: Option<String>,
    #[serde(default)]
    persona_enabled: bool,
    #[serde(default)]
    world_info: Vec<WorldInfoEntry>,
}

impl Default for RoleplaySettings {
    fn default() -> Self {
        Self {
            authors_note: None,
            authors_note_enabled: false,
            persona_name: None,
            persona_description: None,
            persona_enabled: false,
            world_info: Vec::new(),
        }
    }
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

fn get_roleplay_settings_path(character_id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(format!(".config/claudia/roleplay_{}.json", character_id))
}

fn load_roleplay_settings(character_id: &str) -> RoleplaySettings {
    let path = get_roleplay_settings_path(character_id);
    if let Ok(contents) = fs::read_to_string(path) {
        serde_json::from_str(&contents).unwrap_or_default()
    } else {
        RoleplaySettings::default()
    }
}

fn save_roleplay_settings(character_id: &str, settings: &RoleplaySettings) -> Result<(), String> {
    let path = get_roleplay_settings_path(character_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

// PNG Character Card Utilities

// Manual PNG chunk parser - more reliable than relying on png crate's text chunk exposure
fn read_png_text_chunks(png_path: &PathBuf) -> Result<std::collections::HashMap<String, String>, String> {
    use std::io::Read;

    let mut file = fs::File::open(png_path)
        .map_err(|e| format!("Failed to open PNG file: {}", e))?;

    // Read and verify PNG signature
    let mut signature = [0u8; 8];
    file.read_exact(&mut signature)
        .map_err(|e| format!("Failed to read PNG signature: {}", e))?;

    if &signature != b"\x89PNG\r\n\x1a\n" {
        return Err("Not a valid PNG file".to_string());
    }

    let mut text_chunks = std::collections::HashMap::new();
    let mut chunk_buffer = Vec::new();

    loop {
        // Read chunk length (4 bytes, big-endian)
        let mut length_bytes = [0u8; 4];
        if file.read_exact(&mut length_bytes).is_err() {
            break; // End of file
        }
        let length = u32::from_be_bytes(length_bytes) as usize;

        // Read chunk type (4 bytes)
        let mut chunk_type = [0u8; 4];
        file.read_exact(&mut chunk_type)
            .map_err(|e| format!("Failed to read chunk type: {}", e))?;

        // Read chunk data
        chunk_buffer.clear();
        chunk_buffer.resize(length, 0);
        file.read_exact(&mut chunk_buffer)
            .map_err(|e| format!("Failed to read chunk data: {}", e))?;

        // Read CRC (4 bytes, we don't verify it)
        let mut crc = [0u8; 4];
        file.read_exact(&mut crc)
            .map_err(|e| format!("Failed to read CRC: {}", e))?;

        // Process tEXt chunks
        if &chunk_type == b"tEXt" {
            // tEXt format: keyword\0text
            if let Some(null_pos) = chunk_buffer.iter().position(|&b| b == 0) {
                let keyword = String::from_utf8_lossy(&chunk_buffer[..null_pos]).to_string();
                let text = String::from_utf8_lossy(&chunk_buffer[null_pos + 1..]).to_string();
                eprintln!("Found tEXt chunk: keyword='{}', text_len={}", keyword, text.len());
                text_chunks.insert(keyword, text);
            }
        }

        // Stop at IEND chunk
        if &chunk_type == b"IEND" {
            break;
        }
    }

    eprintln!("Total tEXt chunks found: {}", text_chunks.len());
    Ok(text_chunks)
}

fn read_character_card_from_png(png_path: &PathBuf) -> Result<CharacterCardV2Data, String> {
    eprintln!("Reading character card from: {}", png_path.display());

    // Use manual chunk parser - more reliable than png crate
    let text_chunks = read_png_text_chunks(png_path)?;

    // Look for "chara" chunk
    let chara_text = text_chunks.get("chara")
        .ok_or_else(|| {
            eprintln!("Available chunks: {:?}", text_chunks.keys().collect::<Vec<_>>());
            "No character card data found in PNG (missing 'chara' chunk)".to_string()
        })?;

    // Base64 decode
    let json_bytes = base64::engine::general_purpose::STANDARD.decode(&chara_text)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Convert to UTF-8 string
    let json_str = String::from_utf8(json_bytes)
        .map_err(|e| format!("Invalid UTF-8 in character data: {}", e))?;

    // First try to parse as generic value to check spec version
    let generic: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse character card JSON: {}", e))?;

    let spec = generic.get("spec")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No spec field in character card".to_string())?;

    match spec {
        "chara_card_v2" => {
            // Parse as V2 card
            let card: CharacterCardV2 = serde_json::from_value(generic)
                .map_err(|e| format!("Failed to parse V2 card: {}", e))?;
            Ok(card.data)
        }
        "chara_card_v3" => {
            // Parse as V3 card and convert to V2Data
            let card: CharacterCardV3 = serde_json::from_value(generic)
                .map_err(|e| format!("Failed to parse V3 card: {}", e))?;
            Ok(CharacterCardV2Data::from(card))
        }
        _ => Err(format!("Unsupported character card spec: {}", spec))
    }
}

fn write_character_card_to_png(
    character: &Character,
    source_png_path: &PathBuf,
    output_png_path: &PathBuf,
) -> Result<(), String> {
    use image::io::Reader as ImageReader;
    use png::{Encoder, ColorType, BitDepth, Compression};

    // Load the source image
    let img = ImageReader::open(source_png_path)
        .map_err(|e| format!("Failed to open source image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    // Build V2 card
    let card = CharacterCardV2 {
        spec: "chara_card_v2".to_string(),
        spec_version: "2.0".to_string(),
        data: CharacterCardV2Data::from(character.clone()),
    };

    // Serialize to JSON
    let json_str = serde_json::to_string(&card)
        .map_err(|e| format!("Failed to serialize character card: {}", e))?;

    // Base64 encode
    let b64_data = base64::engine::general_purpose::STANDARD.encode(json_str.as_bytes());

    // Create output file
    let file = fs::File::create(output_png_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let w = BufWriter::new(file);

    // Create PNG encoder
    let mut encoder = Encoder::new(w, width, height);
    encoder.set_color(ColorType::Rgba);
    encoder.set_depth(BitDepth::Eight);
    encoder.set_compression(Compression::Default);

    // Add character data as tEXt chunk
    encoder.add_text_chunk("chara".to_string(), b64_data)
        .map_err(|e| format!("Failed to add text chunk: {}", e))?;

    // Write PNG
    let mut writer = encoder.write_header()
        .map_err(|e| format!("Failed to write PNG header: {}", e))?;

    writer.write_image_data(rgba.as_raw())
        .map_err(|e| format!("Failed to write image data: {}", e))?;

    writer.finish()
        .map_err(|e| format!("Failed to finish writing PNG: {}", e))?;

    Ok(())
}

fn create_placeholder_png(output_path: &PathBuf, character_name: &str) -> Result<(), String> {
    use image::{ImageBuffer, Rgba};

    // Create a 512x512 placeholder image with gradient
    let width = 512;
    let height = 512;
    let mut img = ImageBuffer::new(width, height);

    for (x, y, pixel) in img.enumerate_pixels_mut() {
        // Create a simple gradient based on character name hash
        let name_hash = character_name.bytes().fold(0u32, |acc, b| acc.wrapping_add(b as u32));
        let r = ((name_hash % 200) + 55) as u8;
        let g = ((x + y + name_hash) % 200 + 55) as u8;
        let b = ((x.wrapping_mul(2) + y.wrapping_mul(3) + name_hash) % 200 + 55) as u8;
        *pixel = Rgba([r, g, b, 255]);
    }

    img.save(output_path)
        .map_err(|e| format!("Failed to save placeholder image: {}", e))?;

    Ok(())
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
        let mut history: ChatHistory = serde_json::from_str(&contents).unwrap_or(ChatHistory { messages: vec![] });
        // Migrate old messages to new format
        for msg in &mut history.messages {
            msg.migrate();
        }
        history
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
        description: None,
        scenario: None,
        mes_example: None,
        post_history_instructions: None,
        alternate_greetings: Vec::new(),
        character_book: None,
        tags: Vec::new(),
        creator: None,
        character_version: None,
        creator_notes: None,
        extensions: serde_json::Value::Object(serde_json::Map::new()),
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
    description: Option<String>,
    scenario: Option<String>,
    mes_example: Option<String>,
    post_history: Option<String>,
    alt_greetings: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    creator: Option<String>,
    character_version: Option<String>,
    creator_notes: Option<String>,
    avatar_path: Option<String>,
) -> Result<(), String> {
    let mut character = get_active_character();
    character.name = name;
    character.system_prompt = system_prompt;
    character.greeting = greeting;
    character.personality = personality;
    character.description = description;
    character.scenario = scenario;
    character.mes_example = mes_example;
    character.post_history_instructions = post_history;
    character.alternate_greetings = alt_greetings.unwrap_or_default();
    character.tags = tags.unwrap_or_default();
    character.creator = creator;
    character.character_version = character_version;
    character.creator_notes = creator_notes;
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
    history.messages.push(Message::new_user(message.clone()));

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first - use simple Message for API
    let mut api_messages = vec![Message::new_user(character.system_prompt.clone())];
    api_messages[0].role = "system".to_string();

    // Add history messages with current swipe content
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

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
    history.messages.push(Message::new_assistant(assistant_message.clone()));

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
    history.messages.push(Message::new_user(message.clone()));

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first - use simple Message for API
    let mut api_messages = vec![Message::new_user(character.system_prompt.clone())];
    api_messages[0].role = "system".to_string();

    // Add history messages with current swipe content
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

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
    history.messages.push(Message::new_assistant(full_content.clone()));

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
fn truncate_history_from(index: usize) -> Result<(), String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if index < history.messages.len() {
        history.messages.truncate(index);
        save_history(&character.id, &history)?;
    }

    Ok(())
}

#[tauri::command]
fn remove_last_assistant_message() -> Result<String, String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    // Find and remove the last assistant message
    if let Some(pos) = history.messages.iter().rposition(|m| m.role == "assistant") {
        history.messages.remove(pos);
        save_history(&character.id, &history)?;
    }

    // Get the last user message
    let last_user_msg = history.messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.get_content().to_string())
        .ok_or_else(|| "No user message found".to_string())?;

    Ok(last_user_msg)
}

#[tauri::command]
fn get_last_user_message() -> Result<String, String> {
    let character = get_active_character();
    let history = load_history(&character.id);

    // Get the last user message without removing anything
    let last_user_msg = history.messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.get_content().to_string())
        .ok_or_else(|| "No user message found".to_string())?;

    Ok(last_user_msg)
}

#[tauri::command]
async fn generate_response_only() -> Result<String, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let history = load_history(&character.id);

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first
    let mut api_messages = vec![Message::new_user(character.system_prompt.clone())];
    api_messages[0].role = "system".to_string();

    // Add existing history (which already includes the user message)
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

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

    Ok(assistant_message)
}

#[tauri::command]
async fn generate_response_stream(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let history = load_history(&character.id);

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Build messages with system prompt first
    let mut api_messages = vec![Message::new_user(character.system_prompt.clone())];
    api_messages[0].role = "system".to_string();

    // Add existing history (which already includes the user message)
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

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

    // Emit completion event
    let _ = app_handle.emit_to("main", "chat-complete", ());

    Ok(full_content)
}

#[derive(Debug, Serialize)]
struct SwipeInfo {
    current: usize,
    total: usize,
    content: String,
}

#[tauri::command]
fn add_swipe_to_last_assistant(content: String) -> Result<SwipeInfo, String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    // Find the last assistant message
    if let Some(pos) = history.messages.iter().rposition(|m| m.role == "assistant") {
        history.messages[pos].add_swipe(content);
        save_history(&character.id, &history)?;

        Ok(SwipeInfo {
            current: history.messages[pos].current_swipe,
            total: history.messages[pos].swipes.len(),
            content: history.messages[pos].get_content().to_string(),
        })
    } else {
        Err("No assistant message found".to_string())
    }
}

#[tauri::command]
fn navigate_swipe(message_index: usize, direction: i32) -> Result<SwipeInfo, String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err("Invalid message index".to_string());
    }

    let msg = &mut history.messages[message_index];

    if msg.swipes.is_empty() {
        return Err("No swipes available".to_string());
    }

    let new_index = if direction > 0 {
        // Swipe right (next)
        (msg.current_swipe + 1).min(msg.swipes.len() - 1)
    } else {
        // Swipe left (previous)
        msg.current_swipe.saturating_sub(1)
    };

    msg.set_swipe(new_index)?;

    // Extract values before saving
    let current = msg.current_swipe;
    let total = msg.swipes.len();
    let content = msg.get_content().to_string();

    save_history(&character.id, &history)?;

    Ok(SwipeInfo {
        current,
        total,
        content,
    })
}

#[tauri::command]
fn get_swipe_info(message_index: usize) -> Result<SwipeInfo, String> {
    let character = get_active_character();
    let history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err("Invalid message index".to_string());
    }

    let msg = &history.messages[message_index];
    let current = msg.current_swipe;
    let total = msg.swipes.len();
    let content = msg.get_content().to_string();

    Ok(SwipeInfo {
        current,
        total,
        content,
    })
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
        description: None,
        scenario: None,
        mes_example: None,
        post_history_instructions: None,
        alternate_greetings: Vec::new(),
        character_book: None,
        tags: Vec::new(),
        creator: None,
        character_version: None,
        creator_notes: None,
        extensions: serde_json::Value::Object(serde_json::Map::new()),
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

// Import character card from PNG
#[tauri::command]
async fn import_character_card(app_handle: tauri::AppHandle) -> Result<Character, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file picker for PNG files
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Character Cards", &["png"])
        .blocking_pick_file();

    let png_path = if let Some(path) = file_path {
        PathBuf::from(
            path.as_path()
                .ok_or_else(|| "Could not get file path".to_string())?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        return Err("No file selected".to_string());
    };

    // Read character data from PNG
    let card_data = read_character_card_from_png(&png_path)?;

    // Create new character ID
    let new_id = Uuid::new_v4().to_string();

    // Check for name conflicts and append number if needed
    let mut final_name = card_data.name.clone();
    let existing_chars = list_characters()?;
    let mut counter = 1;
    while existing_chars.iter().any(|c| c.name == final_name) {
        final_name = format!("{} ({})", card_data.name, counter);
        counter += 1;
    }

    // Save PNG as avatar
    let avatar_filename = format!("{}.png", new_id);
    let avatar_dest = get_avatar_path(&avatar_filename);

    // Ensure avatars directory exists
    fs::create_dir_all(get_avatars_dir()).map_err(|e| e.to_string())?;

    // Copy PNG to avatars directory
    fs::copy(&png_path, &avatar_dest)
        .map_err(|e| format!("Failed to copy avatar: {}", e))?;

    // Create Character from card data
    let character = Character {
        id: new_id.clone(),
        name: final_name,
        avatar_path: Some(avatar_filename),
        system_prompt: card_data.system_prompt.unwrap_or_else(||
            "You are a helpful AI assistant.".to_string()
        ),
        greeting: card_data.first_mes,
        personality: card_data.personality,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
        description: card_data.description,
        scenario: card_data.scenario,
        mes_example: card_data.mes_example,
        post_history_instructions: card_data.post_history_instructions,
        alternate_greetings: card_data.alternate_greetings,
        character_book: card_data.character_book,
        tags: card_data.tags,
        creator: card_data.creator,
        character_version: card_data.character_version,
        creator_notes: card_data.creator_notes,
        extensions: card_data.extensions,
    };

    // Save character
    save_character(&character)?;

    // Set as active character
    set_active_character(new_id)?;

    Ok(character)
}

// Export chat history to JSON
#[tauri::command]
async fn export_chat_history(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let character = get_active_character();
    let history = load_history(&character.id);

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("Chat History", &["json"])
        .set_file_name(&format!("chat_{}.json", character.name))
        .blocking_save_file();

    let output_path = if let Some(path) = save_path {
        PathBuf::from(
            path.as_path()
                .ok_or_else(|| "Could not get file path".to_string())?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        return Err("Save cancelled".to_string());
    };

    // Write history to JSON file
    let contents = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    fs::write(&output_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// Import chat history from JSON
#[tauri::command]
async fn import_chat_history(app_handle: tauri::AppHandle) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file picker for JSON files
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Chat History", &["json"])
        .blocking_pick_file();

    let json_path = if let Some(path) = file_path {
        PathBuf::from(
            path.as_path()
                .ok_or_else(|| "Could not get file path".to_string())?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        return Err("No file selected".to_string());
    };

    // Read and parse history file
    let contents = fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mut history: ChatHistory = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse history: {}", e))?;

    // Migrate messages to ensure compatibility
    for msg in &mut history.messages {
        msg.migrate();
    }

    let message_count = history.messages.len();

    // Save history for current character
    let character = get_active_character();
    save_history(&character.id, &history)?;

    Ok(message_count)
}

// Roleplay Settings Commands

#[tauri::command]
fn get_roleplay_settings(character_id: String) -> Result<RoleplaySettings, String> {
    Ok(load_roleplay_settings(&character_id))
}

#[tauri::command]
fn update_authors_note(
    character_id: String,
    content: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);
    settings.authors_note = content;
    settings.authors_note_enabled = enabled;
    save_roleplay_settings(&character_id, &settings)
}

#[tauri::command]
fn update_persona(
    character_id: String,
    name: Option<String>,
    description: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);
    settings.persona_name = name;
    settings.persona_description = description;
    settings.persona_enabled = enabled;
    save_roleplay_settings(&character_id, &settings)
}

#[tauri::command]
fn add_world_info_entry(
    character_id: String,
    keys: Vec<String>,
    content: String,
    priority: i32,
    case_sensitive: bool,
) -> Result<WorldInfoEntry, String> {
    let mut settings = load_roleplay_settings(&character_id);

    let entry = WorldInfoEntry {
        id: Uuid::new_v4().to_string(),
        keys,
        content,
        enabled: true,
        case_sensitive,
        priority,
    };

    settings.world_info.push(entry.clone());
    save_roleplay_settings(&character_id, &settings)?;

    Ok(entry)
}

#[tauri::command]
fn update_world_info_entry(
    character_id: String,
    entry_id: String,
    keys: Vec<String>,
    content: String,
    enabled: bool,
    priority: i32,
    case_sensitive: bool,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);

    if let Some(entry) = settings.world_info.iter_mut().find(|e| e.id == entry_id) {
        entry.keys = keys;
        entry.content = content;
        entry.enabled = enabled;
        entry.priority = priority;
        entry.case_sensitive = case_sensitive;
        save_roleplay_settings(&character_id, &settings)
    } else {
        Err("World Info entry not found".to_string())
    }
}

#[tauri::command]
fn delete_world_info_entry(
    character_id: String,
    entry_id: String,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);
    settings.world_info.retain(|e| e.id != entry_id);
    save_roleplay_settings(&character_id, &settings)
}

// Export character card to PNG
#[tauri::command]
async fn export_character_card(app_handle: tauri::AppHandle, character_id: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Load character
    let character = load_character(&character_id)
        .ok_or_else(|| "Character not found".to_string())?;

    // Get source PNG (avatar or create placeholder)
    let source_png = if let Some(avatar_filename) = &character.avatar_path {
        let avatar_path = get_avatar_path(avatar_filename);
        if avatar_path.exists() {
            avatar_path
        } else {
            // Avatar file missing, create placeholder
            let temp_path = std::env::temp_dir().join(format!("{}_temp.png", character.id));
            create_placeholder_png(&temp_path, &character.name)?;
            temp_path
        }
    } else {
        // No avatar, create placeholder
        let temp_path = std::env::temp_dir().join(format!("{}_temp.png", character.id));
        create_placeholder_png(&temp_path, &character.name)?;
        temp_path
    };

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("Character Card", &["png"])
        .set_file_name(&format!("{}.png", character.name))
        .blocking_save_file();

    let output_path = if let Some(path) = save_path {
        PathBuf::from(
            path.as_path()
                .ok_or_else(|| "Could not get file path".to_string())?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        return Err("Save cancelled".to_string());
    };

    // Write character card to PNG
    write_character_card_to_png(&character, &source_png, &output_path)?;

    Ok(output_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chat,
            chat_stream,
            generate_response_only,
            generate_response_stream,
            validate_api,
            save_api_config,
            get_api_config,
            get_chat_history,
            clear_chat_history,
            truncate_history_from,
            remove_last_assistant_message,
            get_last_user_message,
            add_swipe_to_last_assistant,
            navigate_swipe,
            get_swipe_info,
            get_character,
            update_character,
            upload_avatar,
            select_and_upload_avatar,
            get_avatar_full_path,
            list_characters,
            create_character,
            delete_character,
            set_active_character,
            import_character_card,
            export_character_card,
            export_chat_history,
            import_chat_history,
            get_roleplay_settings,
            update_authors_note,
            update_persona,
            add_world_info_entry,
            update_world_info_entry,
            delete_world_info_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
