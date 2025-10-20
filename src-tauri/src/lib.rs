mod plugin_manager;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::io::BufWriter;
use uuid::Uuid;
use futures::StreamExt;
use tauri::Emitter;
use base64::Engine;
use regex::Regex;
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use tiktoken_rs::cl100k_base;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiConfig {
    base_url: String,
    api_key: String,
    model: String,
    #[serde(default)]
    active_character_id: Option<String>,
    #[serde(default)]
    stream: bool,
    #[serde(default = "default_context_limit")]
    context_limit: u32,
}

fn default_context_limit() -> u32 {
    200000
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

    // Expression system
    #[serde(default)]
    expressions: std::collections::HashMap<String, String>, // expression_name -> image_filename
    #[serde(default)]
    default_expression: Option<String>, // default expression to use
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
    #[serde(default)]
    pinned: bool, // Whether this message is pinned to always stay in context
    #[serde(default)]
    hidden: bool, // Whether this message is temporarily hidden from view
    #[serde(default)]
    expression: Option<String>, // Expression name used for this message
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
            pinned: false,
            hidden: false,
            expression: None,
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
            pinned: false,
            hidden: false,
            expression: None,
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
    #[serde(default)]
    use_regex: bool, // Use regex matching instead of literal string matching
}

// Roleplay Settings (Author's Note, Persona, World Info, Prompt Presets)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RoleplaySettings {
    #[serde(default)]
    authors_note: Option<String>,
    #[serde(default)]
    authors_note_enabled: bool,
    #[serde(default = "default_authors_note_depth")]
    authors_note_depth: usize, // Insert before last N messages (default 3)
    #[serde(default)]
    persona_name: Option<String>,
    #[serde(default)]
    persona_description: Option<String>,
    #[serde(default)]
    persona_enabled: bool,
    #[serde(default)]
    world_info: Vec<WorldInfoEntry>,
    #[serde(default = "default_scan_depth")]
    scan_depth: usize, // Scan last N messages for keywords (default 20)
    #[serde(default = "default_recursion_depth")]
    recursion_depth: usize, // Max depth for recursive World Info activation (default 3)
    #[serde(default)]
    active_preset_id: Option<String>, // Selected prompt preset for this character
    #[serde(default)]
    examples_enabled: bool, // Whether to include message examples from character card
    #[serde(default = "default_examples_position")]
    examples_position: String, // Where to insert examples: "after_system" or "before_history"
}

fn default_authors_note_depth() -> usize {
    3
}

fn default_scan_depth() -> usize {
    20
}

fn default_examples_position() -> String {
    "after_system".to_string() // Insert examples after system prompt, before history
}

fn default_recursion_depth() -> usize {
    3
}

impl Default for RoleplaySettings {
    fn default() -> Self {
        Self {
            authors_note: None,
            authors_note_enabled: false,
            authors_note_depth: default_authors_note_depth(),
            persona_name: None,
            persona_description: None,
            persona_enabled: false,
            world_info: Vec::new(),
            scan_depth: default_scan_depth(),
            recursion_depth: default_recursion_depth(),
            active_preset_id: None, // No preset selected by default
            examples_enabled: false, // Message examples disabled by default
            examples_position: default_examples_position(), // After system prompt by default
        }
    }
}

// Prompt Preset System (Simplified MVP)

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstructionBlock {
    id: String,
    name: String,
    content: String,
    enabled: bool,
    #[serde(default)]
    order: i32, // Lower = earlier in context
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FormatHints {
    #[serde(default = "default_wi_format")]
    wi_format: String,  // e.g., "{0}" or "[WorldInfo: {0}]"
    #[serde(default = "default_scenario_format")]
    scenario_format: String, // e.g., "{{scenario}}"
    #[serde(default = "default_personality_format")]
    personality_format: String, // e.g., "[{{char}}'s personality: {{personality}}]"
}

fn default_wi_format() -> String {
    "{0}".to_string()
}

fn default_scenario_format() -> String {
    "{{scenario}}".to_string()
}

fn default_personality_format() -> String {
    "[{{char}}'s personality: {{personality}}]".to_string()
}

impl Default for FormatHints {
    fn default() -> Self {
        Self {
            wi_format: default_wi_format(),
            scenario_format: default_scenario_format(),
            personality_format: default_personality_format(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PromptPreset {
    id: String,
    name: String,
    description: String,
    #[serde(default)]
    system_additions: String,        // Added to character system_prompt
    #[serde(default)]
    authors_note_default: String,    // Default Author's Note content
    #[serde(default)]
    instructions: Vec<InstructionBlock>,
    #[serde(default)]
    format_hints: FormatHints,
}

// Simplified info for listing presets
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PresetInfo {
    id: String,
    name: String,
    description: String,
}

// Create built-in presets

fn create_default_preset() -> PromptPreset {
    PromptPreset {
        id: "default".to_string(),
        name: "Default".to_string(),
        description: "Minimal instructions for general use".to_string(),
        system_additions: String::new(),
        authors_note_default: String::new(),
        instructions: vec![],
        format_hints: FormatHints::default(),
    }
}

fn create_roleplay_preset() -> PromptPreset {
    PromptPreset {
        id: "roleplay".to_string(),
        name: "Roleplay".to_string(),
        description: "Optimized for immersive character roleplay".to_string(),
        system_additions: "\n\n[Roleplay Guidelines:\n- Stay in character at all times\n- Use vivid, descriptive language\n- Show, don't tell - express emotions through actions and dialogue\n- Maintain consistent characterization\n- Respond dynamically to {{user}}'s actions]".to_string(),
        authors_note_default: "[Write detailed, immersive responses focusing on {{char}}'s perspective. Include their thoughts, feelings, and physical reactions.]".to_string(),
        instructions: vec![
            InstructionBlock {
                id: Uuid::new_v4().to_string(),
                name: "Immersion".to_string(),
                content: "[Focus on sensory details and environmental descriptions to create immersion]".to_string(),
                enabled: true,
                order: 1,
            },
            InstructionBlock {
                id: Uuid::new_v4().to_string(),
                name: "Character Voice".to_string(),
                content: "[Maintain {{char}}'s unique voice, speech patterns, and personality traits]".to_string(),
                enabled: true,
                order: 2,
            },
        ],
        format_hints: FormatHints::default(),
    }
}

fn create_creative_writing_preset() -> PromptPreset {
    PromptPreset {
        id: "creative-writing".to_string(),
        name: "Creative Writing".to_string(),
        description: "For collaborative storytelling and narrative co-writing".to_string(),
        system_additions: "\n\n[Creative Writing Mode:\n- Focus on narrative flow and story progression\n- Use varied sentence structure and literary devices\n- Balance description, dialogue, and action\n- Build tension and pacing appropriately\n- Maintain consistent tone and style]".to_string(),
        authors_note_default: "[Continue the narrative with engaging prose. Advance the plot while maintaining character development.]".to_string(),
        instructions: vec![
            InstructionBlock {
                id: Uuid::new_v4().to_string(),
                name: "Narrative Style".to_string(),
                content: "[Write in a literary style with attention to prose quality and storytelling craft]".to_string(),
                enabled: true,
                order: 1,
            },
            InstructionBlock {
                id: Uuid::new_v4().to_string(),
                name: "Story Structure".to_string(),
                content: "[Consider story beats, conflict, and resolution. Build towards meaningful moments]".to_string(),
                enabled: true,
                order: 2,
            },
        ],
        format_hints: FormatHints::default(),
    }
}

fn create_assistant_preset() -> PromptPreset {
    PromptPreset {
        id: "assistant".to_string(),
        name: "Assistant".to_string(),
        description: "Traditional AI assistant behavior for practical tasks".to_string(),
        system_additions: "\n\n[Assistant Guidelines:\n- Provide clear, helpful, and accurate information\n- Be concise but thorough\n- Use formatting (lists, bold, etc.) when it improves clarity\n- Ask clarifying questions when needed\n- Maintain a professional yet friendly tone]".to_string(),
        authors_note_default: "[Focus on being helpful, informative, and user-friendly]".to_string(),
        instructions: vec![
            InstructionBlock {
                id: Uuid::new_v4().to_string(),
                name: "Clarity".to_string(),
                content: "[Organize information logically and use examples when helpful]".to_string(),
                enabled: true,
                order: 1,
            },
        ],
        format_hints: FormatHints::default(),
    }
}

fn get_builtin_presets() -> Vec<PromptPreset> {
    vec![
        create_default_preset(),
        create_roleplay_preset(),
        create_creative_writing_preset(),
        create_assistant_preset(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatHistory {
    messages: Vec<Message>,
}

// New branching structures
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Branch {
    id: String,
    name: String,
    created_at: i64, // Unix timestamp in milliseconds
    #[serde(default)]
    parent_branch_id: Option<String>,
    #[serde(default)]
    diverge_at_index: usize, // Message index in parent where this branch diverged
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BranchedChatHistory {
    #[serde(default = "default_branches")]
    branches: Vec<Branch>,
    #[serde(default = "default_active_branch")]
    active_branch_id: String,
    #[serde(default)]
    branch_messages: std::collections::HashMap<String, Vec<Message>>,
}

fn default_branches() -> Vec<Branch> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    vec![Branch {
        id: "main".to_string(),
        name: "Main".to_string(),
        created_at: timestamp,
        parent_branch_id: None,
        diverge_at_index: 0,
    }]
}

fn default_active_branch() -> String {
    "main".to_string()
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

// Prompt Preset Path and Loading Functions

// Preset cache to avoid disk I/O on every message
static PRESET_CACHE: OnceLock<Mutex<HashMap<String, PromptPreset>>> = OnceLock::new();

fn get_preset_cache() -> &'static Mutex<HashMap<String, PromptPreset>> {
    PRESET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[allow(dead_code)]
fn clear_preset_cache() {
    if let Ok(mut cache) = get_preset_cache().lock() {
        cache.clear();
    }
}

fn get_presets_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".config/claudia/presets")
}

fn get_preset_path(preset_id: &str) -> PathBuf {
    get_presets_dir().join(format!("{}.json", preset_id))
}

fn load_preset(preset_id: &str) -> Option<PromptPreset> {
    // Check cache first
    if let Ok(cache) = get_preset_cache().lock() {
        if let Some(preset) = cache.get(preset_id) {
            return Some(preset.clone());
        }
    }

    // First check if it's a built-in preset
    let builtin_presets = get_builtin_presets();
    if let Some(preset) = builtin_presets.iter().find(|p| p.id == preset_id) {
        // Cache built-in preset
        if let Ok(mut cache) = get_preset_cache().lock() {
            cache.insert(preset_id.to_string(), preset.clone());
        }
        return Some(preset.clone());
    }

    // Then check user presets directory
    let path = get_preset_path(preset_id);
    match fs::read_to_string(&path) {
        Ok(contents) => {
            match serde_json::from_str::<PromptPreset>(&contents) {
                Ok(preset) => {
                    // Cache successfully loaded preset
                    if let Ok(mut cache) = get_preset_cache().lock() {
                        cache.insert(preset_id.to_string(), preset.clone());
                    }
                    Some(preset)
                }
                Err(e) => {
                    eprintln!("Failed to parse preset '{}': {}", preset_id, e);
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to load preset '{}' from {:?}: {}", preset_id, path, e);
            None
        }
    }
}

fn save_preset(preset: &PromptPreset) -> Result<(), String> {
    let dir = get_presets_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = get_preset_path(&preset.id);
    let contents = serde_json::to_string_pretty(preset).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;

    // Invalidate cache for this preset
    if let Ok(mut cache) = get_preset_cache().lock() {
        cache.remove(&preset.id);
    }

    Ok(())
}

fn list_preset_infos() -> Vec<PresetInfo> {
    let mut presets = Vec::new();

    // Add built-in presets
    for preset in get_builtin_presets() {
        presets.push(PresetInfo {
            id: preset.id,
            name: preset.name,
            description: preset.description,
        });
    }

    // Add user presets from directory
    let dir = get_presets_dir();
    if dir.exists() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(contents) = fs::read_to_string(&path) {
                        if let Ok(preset) = serde_json::from_str::<PromptPreset>(&contents) {
                            // Skip if it's a duplicate of a built-in preset
                            if !presets.iter().any(|p| p.id == preset.id) {
                                presets.push(PresetInfo {
                                    id: preset.id,
                                    name: preset.name,
                                    description: preset.description,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    presets
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

// Encode expression images to base64 and add to extensions
fn encode_expressions_to_extensions(
    character: &Character,
    extensions: &mut serde_json::Value,
) -> Result<(), String> {
    if character.expressions.is_empty() {
        return Ok(());
    }

    let mut expressions_data = serde_json::Map::new();

    // Encode each expression image to base64
    for (expr_name, filename) in &character.expressions {
        let expr_path = get_expression_path(&character.id, filename);

        if expr_path.exists() {
            let image_bytes = fs::read(&expr_path)
                .map_err(|e| format!("Failed to read expression {}: {}", expr_name, e))?;

            let base64_data = base64::engine::general_purpose::STANDARD.encode(&image_bytes);

            // Determine MIME type from file extension
            let mime_type = if filename.ends_with(".png") {
                "image/png"
            } else if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                "image/jpeg"
            } else if filename.ends_with(".webp") {
                "image/webp"
            } else {
                "image/png" // default
            };

            let data_uri = format!("data:{};base64,{}", mime_type, base64_data);
            expressions_data.insert(expr_name.clone(), serde_json::Value::String(data_uri));
        }
    }

    // Create claudia_expressions object
    let mut claudia_ext = serde_json::Map::new();
    claudia_ext.insert("expressions".to_string(), serde_json::Value::Object(expressions_data));

    if let Some(default_expr) = &character.default_expression {
        claudia_ext.insert("default".to_string(), serde_json::Value::String(default_expr.clone()));
    }

    // Add to extensions
    if let serde_json::Value::Object(ref mut ext_map) = extensions {
        ext_map.insert("claudia_expressions".to_string(), serde_json::Value::Object(claudia_ext));
    } else {
        // If extensions is not an object, create one
        let mut ext_map = serde_json::Map::new();
        ext_map.insert("claudia_expressions".to_string(), serde_json::Value::Object(claudia_ext));
        *extensions = serde_json::Value::Object(ext_map);
    }

    Ok(())
}

// Decode expression images from extensions and save as files
fn decode_expressions_from_extensions(
    character_id: &str,
    extensions: &serde_json::Value,
) -> Result<(std::collections::HashMap<String, String>, Option<String>), String> {
    use std::collections::HashMap;

    let mut expressions = HashMap::new();
    let mut default_expression = None;

    // Check if claudia_expressions exists in extensions
    if let Some(claudia_ext) = extensions.get("claudia_expressions") {
        // Get default expression
        if let Some(default) = claudia_ext.get("default").and_then(|v| v.as_str()) {
            default_expression = Some(default.to_string());
        }

        // Get expressions object
        if let Some(exprs) = claudia_ext.get("expressions").and_then(|v| v.as_object()) {
            // Ensure expressions directory exists
            let expr_dir = get_expressions_dir(character_id);
            fs::create_dir_all(&expr_dir)
                .map_err(|e| format!("Failed to create expressions directory: {}", e))?;

            for (expr_name, data_uri_value) in exprs {
                if let Some(data_uri) = data_uri_value.as_str() {
                    // Parse data URI (format: "data:image/png;base64,...")
                    if let Some(base64_start) = data_uri.find("base64,") {
                        let base64_data = &data_uri[base64_start + 7..];

                        // Decode base64
                        let image_bytes = base64::engine::general_purpose::STANDARD.decode(base64_data)
                            .map_err(|e| format!("Failed to decode expression {}: {}", expr_name, e))?;

                        // Determine file extension from MIME type
                        let extension = if data_uri.contains("image/jpeg") || data_uri.contains("image/jpg") {
                            "jpg"
                        } else if data_uri.contains("image/webp") {
                            "webp"
                        } else {
                            "png" // default
                        };

                        // Generate filename
                        let filename = format!("{}_{}.{}", character_id, expr_name, extension);
                        let file_path = get_expression_path(character_id, &filename);

                        // Write image file
                        fs::write(&file_path, &image_bytes)
                            .map_err(|e| format!("Failed to write expression {}: {}", expr_name, e))?;

                        expressions.insert(expr_name.clone(), filename);
                    }
                }
            }
        }
    }

    Ok((expressions, default_expression))
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

    // Encode expressions into extensions
    let mut extensions = character.extensions.clone();
    encode_expressions_to_extensions(character, &mut extensions)?;

    // Create a modified character with expression-encoded extensions
    let mut char_with_expressions = character.clone();
    char_with_expressions.extensions = extensions;

    // Build V2 card
    let card = CharacterCardV2 {
        spec: "chara_card_v2".to_string(),
        spec_version: "2.0".to_string(),
        data: CharacterCardV2Data::from(char_with_expressions),
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

// Load branched history (with backward compatibility)
fn load_branched_history(character_id: &str) -> BranchedChatHistory {
    let path = get_character_history_path(character_id);
    if let Ok(contents) = fs::read_to_string(&path) {
        // Try to load as new branched format first
        if let Ok(mut branched) = serde_json::from_str::<BranchedChatHistory>(&contents) {
            // Migrate old messages to new format
            for messages in branched.branch_messages.values_mut() {
                for msg in messages {
                    msg.migrate();
                }
            }
            return branched;
        }

        // Fall back to old linear format and migrate
        if let Ok(mut old_history) = serde_json::from_str::<ChatHistory>(&contents) {
            for msg in &mut old_history.messages {
                msg.migrate();
            }

            // Convert to branched format
            let mut branch_messages = HashMap::new();
            branch_messages.insert("main".to_string(), old_history.messages);

            return BranchedChatHistory {
                branches: default_branches(),
                active_branch_id: "main".to_string(),
                branch_messages,
            };
        }
    }

    // Return empty history with main branch
    let mut branch_messages = HashMap::new();
    branch_messages.insert("main".to_string(), vec![]);

    BranchedChatHistory {
        branches: default_branches(),
        active_branch_id: "main".to_string(),
        branch_messages,
    }
}

// Legacy function - returns active branch messages
fn load_history(character_id: &str) -> ChatHistory {
    let branched = load_branched_history(character_id);
    let messages = branched.branch_messages
        .get(&branched.active_branch_id)
        .cloned()
        .unwrap_or_default();
    ChatHistory { messages }
}

fn save_branched_history(character_id: &str, history: &BranchedChatHistory) -> Result<(), String> {
    let path = get_character_history_path(character_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

// Legacy function - saves to active branch
fn save_history(character_id: &str, history: &ChatHistory) -> Result<(), String> {
    let mut branched = load_branched_history(character_id);
    branched.branch_messages.insert(branched.active_branch_id.clone(), history.messages.clone());
    save_branched_history(character_id, &branched)
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
        expressions: std::collections::HashMap::new(),
        default_expression: None,
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
async fn save_api_config(base_url: String, api_key: String, model: String, stream: bool, context_limit: u32) -> Result<(), String> {
    // Preserve existing active_character_id if it exists
    let active_character_id = load_config().and_then(|c| c.active_character_id);

    let config = ApiConfig {
        base_url,
        api_key,
        model,
        active_character_id,
        stream,
        context_limit,
    };
    save_config(&config)
}

#[tauri::command]
fn get_api_config() -> Result<ApiConfig, String> {
    load_config().ok_or_else(|| "No config found".to_string())
}

// Roleplay Context Injection Logic

// Helper function to check if text contains any keyword from an entry
fn text_matches_entry(text: &str, entry: &WorldInfoEntry) -> bool {
    for keyword in &entry.keys {
        let matches = if entry.use_regex {
            // Use regex matching
            if let Ok(re) = Regex::new(keyword) {
                re.is_match(text)
            } else {
                // Invalid regex - fall back to literal matching
                eprintln!("Invalid regex pattern '{}' for entry {}: falling back to literal match", keyword, entry.id);
                if entry.case_sensitive {
                    text.contains(keyword)
                } else {
                    text.to_lowercase().contains(&keyword.to_lowercase())
                }
            }
        } else {
            // Use literal string matching
            if entry.case_sensitive {
                text.contains(keyword)
            } else {
                text.to_lowercase().contains(&keyword.to_lowercase())
            }
        };

        if matches {
            return true;
        }
    }
    false
}

// Scan messages for World Info keywords and return activated entries (with recursive activation)
fn scan_for_world_info(messages: &[Message], world_info: &[WorldInfoEntry], scan_depth: usize, recursion_depth: usize) -> Vec<WorldInfoEntry> {
    scan_for_world_info_recursive(messages, world_info, scan_depth, recursion_depth)
}

// Recursive World Info scanning with configurable recursion depth
fn scan_for_world_info_recursive(
    messages: &[Message],
    world_info: &[WorldInfoEntry],
    scan_depth: usize,
    recursion_depth: usize,
) -> Vec<WorldInfoEntry> {
    use std::collections::HashSet;

    let mut activated_ids: HashSet<String> = HashSet::new();
    let mut activated_entries: Vec<WorldInfoEntry> = Vec::new();

    // Collect text to scan from messages
    let messages_to_scan: Vec<&Message> = messages.iter()
        .rev()
        .take(scan_depth)
        .collect();

    let mut scan_texts: Vec<String> = messages_to_scan
        .iter()
        .map(|msg| msg.get_content().to_string())
        .collect();

    // Iteratively scan for keywords with depth limit
    for current_depth in 0..recursion_depth {
        let mut newly_activated = Vec::new();

        // Check each enabled entry against current scan texts
        for entry in world_info {
            if !entry.enabled || activated_ids.contains(&entry.id) {
                continue;
            }

            // Check if this entry matches any of the scan texts
            for text in &scan_texts {
                if text_matches_entry(text, entry) {
                    activated_ids.insert(entry.id.clone());
                    newly_activated.push(entry.clone());
                    break;
                }
            }
        }

        // If no new entries were activated, stop recursion
        if newly_activated.is_empty() {
            break;
        }

        // Add newly activated entries to results
        activated_entries.extend(newly_activated.clone());

        // For next iteration, scan the content of newly activated entries
        // (only if we haven't reached max depth)
        if current_depth + 1 < recursion_depth {
            scan_texts = newly_activated
                .iter()
                .map(|entry| entry.content.clone())
                .collect();
        }
    }

    // Sort by priority (higher first)
    activated_entries.sort_by(|a, b| b.priority.cmp(&a.priority));

    activated_entries
}

// Replace template variables in text
fn replace_template_variables(
    text: &str,
    character: &Character,
    settings: &RoleplaySettings,
) -> String {
    use chrono::Local;

    let mut result = text.to_string();

    // {{char}} - Character name
    result = result.replace("{{char}}", &character.name);

    // {{user}} - User name (from persona if enabled, otherwise "User")
    let user_name = if settings.persona_enabled {
        settings.persona_name.as_deref().unwrap_or("User")
    } else {
        "User"
    };
    result = result.replace("{{user}}", user_name);

    // {{date}} - Current date (YYYY-MM-DD format)
    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    result = result.replace("{{date}}", &date_str);

    // {{time}} - Current time (HH:MM format)
    let time_str = now.format("%H:%M").to_string();
    result = result.replace("{{time}}", &time_str);

    result
}

// Parse mes_example field from character card into Message objects
fn parse_message_examples(
    mes_example: &str,
    character: &Character,
    settings: &RoleplaySettings,
) -> Vec<Message> {
    let mut examples = Vec::new();

    // Split by <START> tag to get individual example blocks
    let blocks: Vec<&str> = mes_example
        .split("<START>")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for block in blocks {
        // Process each line in the block
        for line in block.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Replace template variables
            let processed_line = replace_template_variables(line, character, settings);

            // Determine role based on prefix ({{user}}: or {{char}}:)
            // After replacement, it will be the actual names
            let user_name = if settings.persona_enabled {
                settings.persona_name.as_deref().unwrap_or("User")
            } else {
                "User"
            };

            if processed_line.starts_with(&format!("{}:", user_name)) {
                // User message
                let content = processed_line
                    .trim_start_matches(&format!("{}:", user_name))
                    .trim()
                    .to_string();
                examples.push(Message::new_user(content));
            } else if processed_line.starts_with(&format!("{}:", character.name)) {
                // Assistant message
                let content = processed_line
                    .trim_start_matches(&format!("{}:", character.name))
                    .trim()
                    .to_string();
                examples.push(Message::new_assistant(content));
            } else if processed_line.contains(':') {
                // Fallback: split on first colon
                let parts: Vec<&str> = processed_line.splitn(2, ':').collect();
                if parts.len() == 2 {
                    let speaker = parts[0].trim();
                    let content = parts[1].trim().to_string();

                    if speaker == user_name {
                        examples.push(Message::new_user(content));
                    } else {
                        examples.push(Message::new_assistant(content));
                    }
                }
            }
        }
    }

    examples
}

// Build injected context from roleplay settings
fn build_roleplay_context(
    character: &Character,
    messages: &[Message],
    settings: &RoleplaySettings,
) -> (String, Option<String>, usize) {
    let mut system_additions = String::new();
    let mut authors_note_content = None;

    // 0. Apply Prompt Preset instructions if one is selected
    if let Some(preset_id) = &settings.active_preset_id {
        if let Some(preset) = load_preset(preset_id) {
            // Add preset system additions (with template variables replaced)
            if !preset.system_additions.is_empty() {
                let processed_additions = replace_template_variables(&preset.system_additions, character, settings);
                system_additions.push_str(&processed_additions);
            }

            // Add enabled instruction blocks (sorted by order, with template variables replaced)
            let mut enabled_instructions: Vec<_> = preset.instructions.iter()
                .filter(|i| i.enabled)
                .collect();
            enabled_instructions.sort_by_key(|i| i.order);

            for instruction in enabled_instructions {
                let processed_content = replace_template_variables(&instruction.content, character, settings);
                system_additions.push_str(&format!("\n{}", processed_content));
            }

            // Set default Author's Note from preset if user hasn't set one
            if !settings.authors_note_enabled && !preset.authors_note_default.is_empty() {
                let processed_note = replace_template_variables(&preset.authors_note_default, character, settings);
                authors_note_content = Some(processed_note);
            }
        }
    }

    // 1. Add Persona to system prompt (with template variables replaced)
    if settings.persona_enabled {
        if let Some(name) = &settings.persona_name {
            if let Some(desc) = &settings.persona_description {
                let processed_desc = replace_template_variables(desc, character, settings);
                system_additions.push_str(&format!("\n\n[{}'s Persona: {}]", name, processed_desc));
            }
        }
    }

    // 2. Scan for World Info and add to system prompt (with template variables replaced)
    let activated_entries = scan_for_world_info(messages, &settings.world_info, settings.scan_depth, settings.recursion_depth);

    if !activated_entries.is_empty() {
        system_additions.push_str("\n\n[Relevant World Information:");
        for entry in activated_entries {
            let processed_content = replace_template_variables(&entry.content, character, settings);
            system_additions.push_str(&format!("\n- {}", processed_content));
        }
        system_additions.push_str("\n]");
    }

    // 3. Store Author's Note for later injection (with template variables replaced)
    // User's explicit Author's Note overrides preset default
    if settings.authors_note_enabled {
        if let Some(note) = &settings.authors_note {
            if !note.is_empty() {
                let processed_note = replace_template_variables(note, character, settings);
                authors_note_content = Some(processed_note);
            }
        }
    }

    (system_additions, authors_note_content, settings.authors_note_depth)
}

// Helper function to build API messages array with all context injection
fn build_api_messages(
    character: &Character,
    history: &ChatHistory,
    roleplay_settings: &RoleplaySettings,
) -> Vec<Message> {
    // Load roleplay settings and build context
    let (system_additions, authors_note, note_depth) = build_roleplay_context(character, &history.messages, roleplay_settings);

    // Build messages with system prompt first - use simple Message for API (with template variables replaced)
    let processed_system_prompt = replace_template_variables(&character.system_prompt, character, roleplay_settings);
    let enhanced_system_prompt = format!("{}{}", processed_system_prompt, system_additions);
    let mut api_messages = vec![Message::new_user(enhanced_system_prompt)];
    api_messages[0].role = "system".to_string();

    // Insert message examples if enabled
    if roleplay_settings.examples_enabled {
        if let Some(ref mes_example) = character.mes_example {
            if !mes_example.is_empty() {
                let examples = parse_message_examples(mes_example, character, roleplay_settings);

                // Insert examples based on position setting
                match roleplay_settings.examples_position.as_str() {
                    "after_system" => {
                        // Insert right after system message (position 1)
                        for (i, example) in examples.into_iter().enumerate() {
                            api_messages.insert(1 + i, example);
                        }
                    }
                    "before_history" | _ => {
                        // Insert at end (before history gets added)
                        api_messages.extend(examples);
                    }
                }
            }
        }
    }

    // Add history messages with current swipe content
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

    // Insert Author's Note before last N messages if it exists (configurable depth)
    // FIX: If conversation is too short, insert after system message instead of skipping
    if let Some(note) = authors_note {
        let insert_pos = if api_messages.len() > (note_depth + 1) {
            // Normal case: insert before last N messages
            api_messages.len().saturating_sub(note_depth)
        } else {
            // Edge case: conversation too short, insert after system message
            1
        };

        let mut note_msg = Message::new_user(format!("[Author's Note: {}]", note));
        note_msg.role = "system".to_string();
        api_messages.insert(insert_pos, note_msg);
    }

    api_messages
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

    // Build API messages with all roleplay context
    let roleplay_settings = load_roleplay_settings(&character.id);
    let api_messages = build_api_messages(&character, &history, &roleplay_settings);

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

    // Build API messages with all roleplay context
    let roleplay_settings = load_roleplay_settings(&character.id);
    let api_messages = build_api_messages(&character, &history, &roleplay_settings);

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
fn delete_message_at_index(message_index: usize) -> Result<(), String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    history.messages.remove(message_index);
    save_history(&character.id, &history)?;

    Ok(())
}

#[tauri::command]
fn toggle_message_pin(message_index: usize) -> Result<bool, String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    history.messages[message_index].pinned = !history.messages[message_index].pinned;
    let new_state = history.messages[message_index].pinned;
    save_history(&character.id, &history)?;

    Ok(new_state)
}

#[tauri::command]
fn toggle_message_hidden(message_index: usize) -> Result<bool, String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    history.messages[message_index].hidden = !history.messages[message_index].hidden;
    let new_state = history.messages[message_index].hidden;
    save_history(&character.id, &history)?;

    Ok(new_state)
}

// Undo/Redo support commands
#[tauri::command]
fn get_message_at_index(message_index: usize) -> Result<Message, String> {
    let character = get_active_character();
    let history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    Ok(history.messages[message_index].clone())
}

#[tauri::command]
fn insert_message_at_index(message_index: usize, message: Message) -> Result<(), String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index > history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    history.messages.insert(message_index, message);
    save_history(&character.id, &history)?;

    Ok(())
}

#[tauri::command]
fn replace_messages_from_index(start_index: usize, messages: Vec<Message>) -> Result<(), String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if start_index > history.messages.len() {
        return Err(format!("Start index {} out of bounds", start_index));
    }

    // Remove all messages from start_index onward
    history.messages.truncate(start_index);

    // Add the new messages
    history.messages.extend(messages);
    save_history(&character.id, &history)?;

    Ok(())
}

#[tauri::command]
async fn continue_message(message_index: usize) -> Result<String, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    // Make sure we're continuing an assistant message
    if history.messages[message_index].role != "assistant" {
        return Err("Can only continue assistant messages".to_string());
    }

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Load roleplay settings and build context up to the message we're continuing
    let roleplay_settings = load_roleplay_settings(&character.id);
    let messages_up_to = &history.messages[..=message_index];
    let (system_additions, authors_note, note_depth) = build_roleplay_context(&character, messages_up_to, &roleplay_settings);

    // Build API messages (same pattern as generate_response_only)
    let processed_system_prompt = replace_template_variables(&character.system_prompt, &character, &roleplay_settings);
    let enhanced_system_prompt = format!("{}{}", processed_system_prompt, system_additions);
    let mut api_messages = vec![Message::new_user(enhanced_system_prompt)];
    api_messages[0].role = "system".to_string();

    // Add existing history up to the message we're continuing
    for msg in messages_up_to {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

    // Insert Author's Note
    if let Some(note) = authors_note {
        if api_messages.len() > (note_depth + 1) {
            let insert_pos = api_messages.len().saturating_sub(note_depth);
            let mut note_msg = Message::new_user(note);
            note_msg.role = "system".to_string();
            api_messages.insert(insert_pos, note_msg);
        }
    }

    // Convert to API format
    let api_request = ChatRequest {
        model: config.model.clone(),
        messages: api_messages,
        max_tokens: 4096,
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&api_request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API error: {}", error_text));
    }

    let response_json: ChatResponse = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = response_json.choices.first()
        .map(|c| &c.message.content)
        .ok_or_else(|| "No content in response".to_string())?
        .to_string();

    // Append the new content to the existing message
    let current_content = history.messages[message_index].get_content().to_string();
    let continued_content = format!("{}{}", current_content, content);

    // Update the current swipe
    let swipe_index = history.messages[message_index].current_swipe;
    history.messages[message_index].swipes[swipe_index] = continued_content.clone();
    history.messages[message_index].content = continued_content.clone();

    save_history(&character.id, &history)?;

    Ok(content)
}

#[tauri::command]
async fn regenerate_at_index(message_index: usize) -> Result<SwipeInfo, String> {
    let config = load_config().ok_or_else(|| "API not configured".to_string())?;
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of bounds", message_index));
    }

    // Make sure we're regenerating an assistant message
    if history.messages[message_index].role != "assistant" {
        return Err("Can only regenerate assistant messages".to_string());
    }

    let client = reqwest::Client::new();
    let base = config.base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    };

    // Load roleplay settings and build context up to (but not including) the message we're regenerating
    let roleplay_settings = load_roleplay_settings(&character.id);
    let messages_before = &history.messages[..message_index];
    let (system_additions, authors_note, note_depth) = build_roleplay_context(&character, messages_before, &roleplay_settings);

    // Build API messages
    let processed_system_prompt = replace_template_variables(&character.system_prompt, &character, &roleplay_settings);
    let enhanced_system_prompt = format!("{}{}", processed_system_prompt, system_additions);
    let mut api_messages = vec![Message::new_user(enhanced_system_prompt)];
    api_messages[0].role = "system".to_string();

    // Add existing history up to the message we're regenerating
    for msg in messages_before {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

    // Insert Author's Note
    if let Some(note) = authors_note {
        if api_messages.len() > (note_depth + 1) {
            let insert_pos = api_messages.len().saturating_sub(note_depth);
            let mut note_msg = Message::new_user(note);
            note_msg.role = "system".to_string();
            api_messages.insert(insert_pos, note_msg);
        }
    }

    // Convert to API format
    let api_request = ChatRequest {
        model: config.model.clone(),
        messages: api_messages,
        max_tokens: 4096,
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&api_request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API error: {}", error_text));
    }

    let response_json: ChatResponse = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = response_json.choices.first()
        .map(|c| &c.message.content)
        .ok_or_else(|| "No content in response".to_string())?
        .to_string();

    // Add as a new swipe to this message
    history.messages[message_index].swipes.push(content.clone());
    let new_swipe_index = history.messages[message_index].swipes.len() - 1;
    history.messages[message_index].current_swipe = new_swipe_index;
    history.messages[message_index].content = content.clone();

    save_history(&character.id, &history)?;

    Ok(SwipeInfo {
        content,
        current: new_swipe_index,
        total: history.messages[message_index].swipes.len(),
    })
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

    // Load roleplay settings and build context
    let roleplay_settings = load_roleplay_settings(&character.id);
    let (system_additions, authors_note, note_depth) = build_roleplay_context(&character, &history.messages, &roleplay_settings);

    // Build messages with enhanced system prompt first (with template variables replaced)
    let processed_system_prompt = replace_template_variables(&character.system_prompt, &character, &roleplay_settings);
    let enhanced_system_prompt = format!("{}{}", processed_system_prompt, system_additions);
    let mut api_messages = vec![Message::new_user(enhanced_system_prompt)];
    api_messages[0].role = "system".to_string();

    // Add existing history (which already includes the user message)
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

    // Insert Author's Note before last N messages if it exists (configurable depth)
    if let Some(note) = authors_note {
        if api_messages.len() > (note_depth + 1) { // system + at least note_depth messages
            let insert_pos = api_messages.len().saturating_sub(note_depth);
            let mut note_msg = Message::new_user(format!("[Author's Note: {}]", note));
            note_msg.role = "system".to_string();
            api_messages.insert(insert_pos, note_msg);
        }
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

    // Load roleplay settings and build context
    let roleplay_settings = load_roleplay_settings(&character.id);
    let (system_additions, authors_note, note_depth) = build_roleplay_context(&character, &history.messages, &roleplay_settings);

    // Build messages with enhanced system prompt first (with template variables replaced)
    let processed_system_prompt = replace_template_variables(&character.system_prompt, &character, &roleplay_settings);
    let enhanced_system_prompt = format!("{}{}", processed_system_prompt, system_additions);
    let mut api_messages = vec![Message::new_user(enhanced_system_prompt)];
    api_messages[0].role = "system".to_string();

    // Add existing history (which already includes the user message)
    for msg in &history.messages {
        let mut api_msg = Message::new_user(msg.get_content().to_string());
        api_msg.role = msg.role.clone();
        api_messages.push(api_msg);
    }

    // Insert Author's Note before last N messages if it exists (configurable depth)
    if let Some(note) = authors_note {
        if api_messages.len() > (note_depth + 1) { // system + at least note_depth messages
            let insert_pos = api_messages.len().saturating_sub(note_depth);
            let mut note_msg = Message::new_user(format!("[Author's Note: {}]", note));
            note_msg.role = "system".to_string();
            api_messages.insert(insert_pos, note_msg);
        }
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
        expressions: std::collections::HashMap::new(),
        default_expression: None,
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

    // Decode expressions from extensions (do this before name conflict check)
    let (expressions, default_expression) = decode_expressions_from_extensions(&new_id, &card_data.extensions)?;

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
        expressions,
        default_expression,
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

// Export chat history as Markdown
#[tauri::command]
async fn export_chat_as_markdown(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let character = get_active_character();
    let history = load_history(&character.id);

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(&format!("chat_{}.md", character.name))
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

    // Build markdown content
    let mut contents = String::new();
    contents.push_str(&format!("# Chat with {}\n\n", character.name));

    for msg in &history.messages {
        let role_label = if msg.role == "user" { "**User**" } else { "**Assistant**" };
        contents.push_str(&format!("{}: {}\n\n", role_label, msg.get_content()));
    }

    fs::write(&output_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// Export chat history as plain text
#[tauri::command]
async fn export_chat_as_text(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let character = get_active_character();
    let history = load_history(&character.id);

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("Text", &["txt"])
        .set_file_name(&format!("chat_{}.txt", character.name))
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

    // Build plain text content
    let mut contents = String::new();
    contents.push_str(&format!("Chat with {}\n", character.name));
    contents.push_str(&"=".repeat(50));
    contents.push_str("\n\n");

    for msg in &history.messages {
        let role_label = if msg.role == "user" { "User" } else { "Assistant" };
        contents.push_str(&format!("{}: {}\n\n", role_label, msg.get_content()));
    }

    fs::write(&output_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// Export chat history as HTML
#[tauri::command]
async fn export_chat_as_html(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let character = get_active_character();
    let history = load_history(&character.id);

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(&format!("chat_{}.html", character.name))
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

    // Build HTML content with styling
    let mut contents = String::new();
    contents.push_str("<!DOCTYPE html>\n<html>\n<head>\n");
    contents.push_str("    <meta charset=\"UTF-8\">\n");
    contents.push_str(&format!("    <title>Chat with {}</title>\n", character.name));
    contents.push_str("    <style>\n");
    contents.push_str("        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f5f5f5; }\n");
    contents.push_str("        h1 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px; }\n");
    contents.push_str("        .message { margin: 20px 0; padding: 15px; border-radius: 8px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n");
    contents.push_str("        .user { border-left: 4px solid #4CAF50; }\n");
    contents.push_str("        .assistant { border-left: 4px solid #2196F3; }\n");
    contents.push_str("        .role { font-weight: bold; margin-bottom: 8px; color: #555; }\n");
    contents.push_str("        .content { line-height: 1.6; color: #333; white-space: pre-wrap; }\n");
    contents.push_str("    </style>\n");
    contents.push_str("</head>\n<body>\n");
    contents.push_str(&format!("    <h1>Chat with {}</h1>\n", character.name));

    for msg in &history.messages {
        let role_class = if msg.role == "user" { "user" } else { "assistant" };
        let role_label = if msg.role == "user" { "User" } else { "Assistant" };
        let content = msg.get_content().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");

        contents.push_str(&format!("    <div class=\"message {}\">\n", role_class));
        contents.push_str(&format!("        <div class=\"role\">{}</div>\n", role_label));
        contents.push_str(&format!("        <div class=\"content\">{}</div>\n", content));
        contents.push_str("    </div>\n");
    }

    contents.push_str("</body>\n</html>");

    fs::write(&output_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// Parse chat history from Markdown format
fn parse_markdown_chat(contents: &str) -> Result<ChatHistory, String> {
    use regex::Regex;

    let mut messages = Vec::new();

    // Pattern: **User**: content or **Assistant**: content
    let re = Regex::new(r"(?m)^\*\*(User|Assistant)\*\*:\s*(.+?)(?=^\*\*(?:User|Assistant)\*\*:|$)")
        .map_err(|e| format!("Regex error: {}", e))?;

    for cap in re.captures_iter(contents) {
        let role = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let content = cap.get(2).map(|m| m.as_str()).unwrap_or("").trim();

        if !content.is_empty() {
            let message = if role == "User" {
                Message::new_user(content.to_string())
            } else {
                Message::new_assistant(content.to_string())
            };
            messages.push(message);
        }
    }

    if messages.is_empty() {
        return Err("No messages found in Markdown file".to_string());
    }

    Ok(ChatHistory { messages })
}

// Parse chat history from HTML format
fn parse_html_chat(contents: &str) -> Result<ChatHistory, String> {
    use regex::Regex;

    let mut messages = Vec::new();

    // Pattern: <div class="message user|assistant">...<div class="content">content</div>...
    let message_re = Regex::new(r#"<div class="message (user|assistant)">"#)
        .map_err(|e| format!("Regex error: {}", e))?;
    let content_re = Regex::new(r#"<div class="content">(.+?)</div>"#)
        .map_err(|e| format!("Regex error: {}", e))?;

    // Split by message divs
    let parts: Vec<&str> = message_re.split(contents).collect();
    let mut role_iter = message_re.captures_iter(contents);

    for (_i, part) in parts.iter().enumerate().skip(1) {
        if let Some(role_cap) = role_iter.next() {
            let role = role_cap.get(1).map(|m| m.as_str()).unwrap_or("");

            if let Some(content_cap) = content_re.captures(part) {
                let content = content_cap.get(1).map(|m| m.as_str()).unwrap_or("");
                // Decode HTML entities
                let decoded = content
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&")
                    .replace("&quot;", "\"")
                    .trim()
                    .to_string();

                if !decoded.is_empty() {
                    let message = if role == "user" {
                        Message::new_user(decoded)
                    } else {
                        Message::new_assistant(decoded)
                    };
                    messages.push(message);
                }
            }
        }
    }

    if messages.is_empty() {
        return Err("No messages found in HTML file".to_string());
    }

    Ok(ChatHistory { messages })
}

// Parse chat history from plain text format
fn parse_text_chat(contents: &str) -> Result<ChatHistory, String> {
    use regex::Regex;

    let mut messages = Vec::new();

    // Pattern: User: content or Assistant: content (at start of line)
    let re = Regex::new(r"(?m)^(User|Assistant):\s*(.+?)(?=^(?:User|Assistant):|$)")
        .map_err(|e| format!("Regex error: {}", e))?;

    for cap in re.captures_iter(contents) {
        let role = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let content = cap.get(2).map(|m| m.as_str()).unwrap_or("").trim();

        if !content.is_empty() {
            let message = if role == "User" {
                Message::new_user(content.to_string())
            } else {
                Message::new_assistant(content.to_string())
            };
            messages.push(message);
        }
    }

    if messages.is_empty() {
        return Err("No messages found in text file".to_string());
    }

    Ok(ChatHistory { messages })
}

// Import chat history from multiple formats (JSON, Markdown, HTML, Text)
#[tauri::command]
async fn import_chat_history(app_handle: tauri::AppHandle) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file picker for multiple formats
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("All Supported", &["json", "md", "html", "txt"])
        .add_filter("JSON", &["json"])
        .add_filter("Markdown", &["md"])
        .add_filter("HTML", &["html"])
        .add_filter("Plain Text", &["txt"])
        .blocking_pick_file();

    let file_path_buf = if let Some(path) = file_path {
        PathBuf::from(
            path.as_path()
                .ok_or_else(|| "Could not get file path".to_string())?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        return Err("No file selected".to_string());
    };

    // Read file contents
    let contents = fs::read_to_string(&file_path_buf)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Detect format based on file extension
    let extension = file_path_buf
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let history = match extension.to_lowercase().as_str() {
        "json" => {
            // Parse JSON format
            let mut h: ChatHistory = serde_json::from_str(&contents)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;
            // Migrate messages to ensure compatibility
            for msg in &mut h.messages {
                msg.migrate();
            }
            h
        }
        "md" => {
            // Parse Markdown format
            parse_markdown_chat(&contents)?
        }
        "html" => {
            // Parse HTML format
            parse_html_chat(&contents)?
        }
        "txt" => {
            // Parse plain text format
            parse_text_chat(&contents)?
        }
        _ => {
            return Err(format!("Unsupported file format: {}", extension));
        }
    };

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

// Validate a regex pattern
#[tauri::command]
fn validate_regex_pattern(pattern: String) -> Result<bool, String> {
    match Regex::new(&pattern) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Invalid regex pattern: {}", e))
    }
}

// Update roleplay settings with validation
#[tauri::command]
fn update_roleplay_depths(
    character_id: String,
    scan_depth: Option<usize>,
    authors_note_depth: Option<usize>,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);

    // Validate scan_depth (should be between 1 and 100)
    if let Some(depth) = scan_depth {
        if depth < 1 || depth > 100 {
            return Err("Scan depth must be between 1 and 100".to_string());
        }
        settings.scan_depth = depth;
    }

    // Validate authors_note_depth (should be between 1 and 50)
    if let Some(depth) = authors_note_depth {
        if depth < 1 || depth > 50 {
            return Err("Author's Note depth must be between 1 and 50".to_string());
        }
        settings.authors_note_depth = depth;
    }

    save_roleplay_settings(&character_id, &settings)
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
fn update_examples_settings(
    character_id: String,
    enabled: bool,
    position: String,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);
    settings.examples_enabled = enabled;
    settings.examples_position = position;
    save_roleplay_settings(&character_id, &settings)
}

#[tauri::command]
fn update_recursion_depth(
    character_id: String,
    depth: usize,
) -> Result<(), String> {
    // Validate recursion depth (should be between 0 and 10)
    if depth > 10 {
        return Err("Recursion depth must be between 0 and 10".to_string());
    }

    let mut settings = load_roleplay_settings(&character_id);
    settings.recursion_depth = depth;
    save_roleplay_settings(&character_id, &settings)
}

// Prompt Preset Commands

#[tauri::command]
fn get_presets() -> Result<Vec<PresetInfo>, String> {
    Ok(list_preset_infos())
}

#[tauri::command]
fn get_preset(preset_id: String) -> Result<PromptPreset, String> {
    load_preset(&preset_id).ok_or_else(|| format!("Preset '{}' not found", preset_id))
}

#[tauri::command]
fn set_active_preset(
    character_id: String,
    preset_id: Option<String>,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);
    settings.active_preset_id = preset_id;
    save_roleplay_settings(&character_id, &settings)
}

#[tauri::command]
fn save_custom_preset(preset: PromptPreset) -> Result<(), String> {
    // Validate that it's not overwriting a built-in preset
    let builtin_ids: Vec<String> = get_builtin_presets().iter().map(|p| p.id.clone()).collect();
    if builtin_ids.contains(&preset.id) {
        return Err("Cannot overwrite built-in presets".to_string());
    }

    save_preset(&preset)
}

#[tauri::command]
fn update_preset_instructions(
    preset_id: String,
    instructions: Vec<InstructionBlock>,
) -> Result<(), String> {
    // Cannot update built-in presets
    let builtin_ids: Vec<String> = get_builtin_presets().iter().map(|p| p.id.clone()).collect();
    if builtin_ids.contains(&preset_id) {
        return Err("Cannot modify built-in presets".to_string());
    }

    // Load the preset
    let mut preset = load_preset(&preset_id)
        .ok_or_else(|| format!("Preset '{}' not found", preset_id))?;

    // Update instructions
    preset.instructions = instructions;

    // Save back
    save_preset(&preset)
}

#[tauri::command]
fn delete_custom_preset(preset_id: String) -> Result<(), String> {
    // Cannot delete built-in presets
    let builtin_ids: Vec<String> = get_builtin_presets().iter().map(|p| p.id.clone()).collect();
    if builtin_ids.contains(&preset_id) {
        return Err("Cannot delete built-in presets".to_string());
    }

    let path = get_preset_path(&preset_id);
    fs::remove_file(path).map_err(|e| format!("Failed to delete preset: {}", e))?;

    // Invalidate cache for this preset
    if let Ok(mut cache) = get_preset_cache().lock() {
        cache.remove(&preset_id);
    }

    Ok(())
}

#[tauri::command]
fn duplicate_preset(source_preset_id: String, new_name: String) -> Result<PromptPreset, String> {
    // Load the source preset (can be built-in or custom)
    let source_preset = load_preset(&source_preset_id)
        .ok_or_else(|| format!("Source preset '{}' not found", source_preset_id))?;

    // Create new preset ID from name
    let new_id = new_name.to_lowercase().replace(' ', "_");

    // Check if preset with this ID already exists
    if load_preset(&new_id).is_some() {
        return Err(format!("A preset with ID '{}' already exists", new_id));
    }

    // Create the duplicated preset
    let new_preset = PromptPreset {
        id: new_id,
        name: new_name,
        description: format!("Copy of {}", source_preset.name),
        system_additions: source_preset.system_additions.clone(),
        authors_note_default: source_preset.authors_note_default.clone(),
        instructions: source_preset.instructions.clone(),
        format_hints: source_preset.format_hints.clone(),
    };

    // Save as custom preset
    save_preset(&new_preset)?;

    Ok(new_preset)
}

#[tauri::command]
fn is_builtin_preset_modified(preset_id: String) -> bool {
    // Check if it's a built-in preset ID
    let builtin_ids = vec!["default", "roleplay", "creative-writing", "assistant"];
    if !builtin_ids.contains(&preset_id.as_str()) {
        return false;
    }

    // Check if a custom override exists
    let path = get_preset_path(&preset_id);
    path.exists()
}

#[tauri::command]
fn restore_builtin_preset(preset_id: String) -> Result<PromptPreset, String> {
    // Verify it's a built-in preset
    let builtin_ids = vec!["default", "roleplay", "creative-writing", "assistant"];
    if !builtin_ids.contains(&preset_id.as_str()) {
        return Err("Can only restore built-in presets".to_string());
    }

    // Delete the custom override if it exists
    let path = get_preset_path(&preset_id);
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to delete override: {}", e))?;
    }

    // Invalidate cache
    if let Ok(mut cache) = get_preset_cache().lock() {
        cache.remove(&preset_id);
    }

    // Load and return the built-in preset
    load_preset(&preset_id)
        .ok_or_else(|| format!("Built-in preset '{}' not found", preset_id))
}

// Token Counting

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenBreakdown {
    total: usize,
    system_prompt: usize,
    preset_instructions: usize,
    persona: usize,
    world_info: usize,
    authors_note: usize,
    message_examples: usize,
    message_history: usize,
    current_input: usize,
    estimated_max_tokens: usize,
}

// Helper function to count tokens in a string
fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }

    let bpe = cl100k_base().unwrap();
    bpe.encode_with_special_tokens(text).len()
}

#[tauri::command]
fn get_token_count(character_id: Option<String>, current_input: String) -> Result<TokenBreakdown, String> {
    // Get character (either specified or active)
    let character = if let Some(id) = character_id {
        load_character(&id).ok_or_else(|| format!("Character '{}' not found", id))?
    } else {
        get_active_character()
    };

    let history = load_history(&character.id);
    let roleplay_settings = load_roleplay_settings(&character.id);

    // Build the same context that would be sent to the API
    let (_system_additions, authors_note, _note_depth) = build_roleplay_context(&character, &history.messages, &roleplay_settings);

    // Count system prompt (including template processing)
    let processed_system_prompt = replace_template_variables(&character.system_prompt, &character, &roleplay_settings);
    let system_prompt_tokens = count_tokens(&processed_system_prompt);

    // Parse system additions to break down by component
    let mut preset_tokens = 0;
    let mut persona_tokens = 0;
    let mut world_info_tokens = 0;

    // Count preset instructions and system additions
    if let Some(preset_id) = &roleplay_settings.active_preset_id {
        if let Some(preset) = load_preset(preset_id) {
            if !preset.system_additions.is_empty() {
                let processed_additions = replace_template_variables(&preset.system_additions, &character, &roleplay_settings);
                preset_tokens += count_tokens(&processed_additions);
            }

            let mut enabled_instructions: Vec<_> = preset.instructions.iter()
                .filter(|i| i.enabled)
                .collect();
            enabled_instructions.sort_by_key(|i| i.order);

            for instruction in enabled_instructions {
                let processed_content = replace_template_variables(&instruction.content, &character, &roleplay_settings);
                preset_tokens += count_tokens(&processed_content);
            }
        }
    }

    // Count persona
    if roleplay_settings.persona_enabled {
        if let Some(name) = &roleplay_settings.persona_name {
            if let Some(desc) = &roleplay_settings.persona_description {
                let processed_desc = replace_template_variables(desc, &character, &roleplay_settings);
                let persona_text = format!("\n\n[{}'s Persona: {}]", name, processed_desc);
                persona_tokens = count_tokens(&persona_text);
            }
        }
    }

    // Count world info
    let activated_entries = scan_for_world_info(&history.messages, &roleplay_settings.world_info, roleplay_settings.scan_depth, roleplay_settings.recursion_depth);
    if !activated_entries.is_empty() {
        let mut wi_text = String::from("\n\n[Relevant World Information:");
        for entry in activated_entries {
            let processed_content = replace_template_variables(&entry.content, &character, &roleplay_settings);
            wi_text.push_str(&format!("\n- {}", processed_content));
        }
        wi_text.push_str("\n]");
        world_info_tokens = count_tokens(&wi_text);
    }

    // Count author's note
    let authors_note_tokens = if let Some(note) = authors_note {
        let note_text = format!("[Author's Note: {}]", note);
        count_tokens(&note_text)
    } else {
        0
    };

    // Count message examples
    let mut examples_tokens = 0;
    if roleplay_settings.examples_enabled {
        if let Some(ref mes_example) = character.mes_example {
            if !mes_example.is_empty() {
                let examples = parse_message_examples(mes_example, &character, &roleplay_settings);
                for example in examples {
                    examples_tokens += count_tokens(example.get_content());
                }
            }
        }
    }

    // Count message history
    let mut history_tokens = 0;
    for msg in &history.messages {
        history_tokens += count_tokens(msg.get_content());
    }

    // Count current input
    let input_tokens = count_tokens(&current_input);

    // Calculate total
    let total = system_prompt_tokens + preset_tokens + persona_tokens + world_info_tokens +
                authors_note_tokens + examples_tokens + history_tokens + input_tokens;

    // Estimate remaining tokens for response (assuming 16k context with 4k max response)
    let estimated_max_tokens = if total < 12000 { 4096 } else { 16384 - total };

    Ok(TokenBreakdown {
        total,
        system_prompt: system_prompt_tokens,
        preset_instructions: preset_tokens,
        persona: persona_tokens,
        world_info: world_info_tokens,
        authors_note: authors_note_tokens,
        message_examples: examples_tokens,
        message_history: history_tokens,
        current_input: input_tokens,
        estimated_max_tokens,
    })
}

// World Info Commands

#[tauri::command]
fn add_world_info_entry(
    character_id: String,
    keys: Vec<String>,
    content: String,
    priority: i32,
    case_sensitive: bool,
    use_regex: bool,
) -> Result<WorldInfoEntry, String> {
    let mut settings = load_roleplay_settings(&character_id);

    // Validate regex patterns if use_regex is true
    if use_regex {
        for key in &keys {
            if let Err(e) = Regex::new(key) {
                return Err(format!("Invalid regex pattern '{}': {}", key, e));
            }
        }
    }

    // Validate that keys is not empty
    if keys.is_empty() {
        return Err("At least one keyword is required".to_string());
    }

    // Validate that content is not empty
    if content.trim().is_empty() {
        return Err("Content cannot be empty".to_string());
    }

    let entry = WorldInfoEntry {
        id: Uuid::new_v4().to_string(),
        keys,
        content,
        enabled: true,
        case_sensitive,
        priority,
        use_regex,
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
    use_regex: bool,
) -> Result<(), String> {
    let mut settings = load_roleplay_settings(&character_id);

    // Validate regex patterns if use_regex is true
    if use_regex {
        for key in &keys {
            if let Err(e) = Regex::new(key) {
                return Err(format!("Invalid regex pattern '{}': {}", key, e));
            }
        }
    }

    // Validate that keys is not empty
    if keys.is_empty() {
        return Err("At least one keyword is required".to_string());
    }

    // Validate that content is not empty
    if content.trim().is_empty() {
        return Err("Content cannot be empty".to_string());
    }

    if let Some(entry) = settings.world_info.iter_mut().find(|e| e.id == entry_id) {
        entry.keys = keys;
        entry.content = content;
        entry.enabled = enabled;
        entry.priority = priority;
        entry.case_sensitive = case_sensitive;
        entry.use_regex = use_regex;
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

// Export World Info entries to JSON
#[tauri::command]
async fn export_world_info(
    app_handle: tauri::AppHandle,
    character_id: String,
    format: String, // "native" or "sillytavern"
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let settings = load_roleplay_settings(&character_id);
    let character = load_character(&character_id)
        .ok_or_else(|| "Character not found".to_string())?;

    // Open save dialog
    let save_path = app_handle
        .dialog()
        .file()
        .add_filter("World Info", &["json"])
        .set_file_name(&format!("worldinfo_{}.json", character.name))
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

    // Serialize based on format
    let contents = match format.as_str() {
        "sillytavern" => {
            let st_data = convert_to_sillytavern_format(&settings.world_info);
            serde_json::to_string_pretty(&st_data)
                .map_err(|e| format!("Failed to serialize World Info: {}", e))?
        }
        _ => {
            // Default to native format
            serde_json::to_string_pretty(&settings.world_info)
                .map_err(|e| format!("Failed to serialize World Info: {}", e))?
        }
    };

    fs::write(&output_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

// SillyTavern World Info format structs
#[derive(Debug, Serialize, Deserialize)]
struct SillyTavernWorldInfoEntry {
    uid: u32,
    key: Vec<String>,
    #[serde(default)]
    keysecondary: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable: Option<bool>,
    #[serde(default)]
    order: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    case_sensitive: Option<bool>,
    // SillyTavern has many other fields with defaults we need to include for compatibility
    #[serde(default)]
    constant: bool,
    #[serde(default)]
    selective: bool,
    #[serde(default)]
    vectorized: bool,
    #[serde(default = "default_depth")]
    depth: i32,
    #[serde(default = "default_probability")]
    probability: i32,
    #[serde(default)]
    position: i32,
}

// Default values for SillyTavern fields
fn default_depth() -> i32 { 4 }
fn default_probability() -> i32 { 100 }

#[derive(Debug, Serialize, Deserialize)]
struct SillyTavernWorldInfo {
    entries: std::collections::HashMap<String, SillyTavernWorldInfoEntry>,
}

// Convert SillyTavern World Info entry to our format (import)
fn convert_sillytavern_entry(st_entry: SillyTavernWorldInfoEntry) -> WorldInfoEntry {
    // Combine primary and secondary keys
    let mut all_keys = st_entry.key;
    all_keys.extend(st_entry.keysecondary);

    WorldInfoEntry {
        id: Uuid::new_v4().to_string(),
        keys: all_keys,
        content: st_entry.content,
        enabled: !st_entry.disable.unwrap_or(false), // SillyTavern uses 'disable', we use 'enabled'
        case_sensitive: st_entry.case_sensitive.unwrap_or(false),
        priority: st_entry.order, // SillyTavern uses 'order' for priority
        use_regex: false,
    }
}

// Convert our World Info format to SillyTavern format (export)
fn convert_to_sillytavern_format(entries: &[WorldInfoEntry]) -> SillyTavernWorldInfo {
    let mut st_entries = std::collections::HashMap::new();

    for (index, entry) in entries.iter().enumerate() {
        let st_entry = SillyTavernWorldInfoEntry {
            uid: index as u32,
            key: entry.keys.clone(),
            keysecondary: vec![],
            comment: None,
            content: entry.content.clone(),
            disable: Some(!entry.enabled), // We use 'enabled', SillyTavern uses 'disable'
            order: entry.priority,
            case_sensitive: if entry.case_sensitive { Some(true) } else { None },
            constant: false,
            selective: true,
            vectorized: false,
            depth: 4,
            probability: 100,
            position: 0,
        };

        st_entries.insert(index.to_string(), st_entry);
    }

    SillyTavernWorldInfo {
        entries: st_entries,
    }
}

// Try to parse as SillyTavern format first, fall back to our native format
fn parse_world_info_json(contents: &str) -> Result<Vec<WorldInfoEntry>, String> {
    // Try SillyTavern format first
    if let Ok(st_data) = serde_json::from_str::<SillyTavernWorldInfo>(contents) {
        let entries: Vec<WorldInfoEntry> = st_data
            .entries
            .into_iter()
            .map(|(_, entry)| convert_sillytavern_entry(entry))
            .collect();
        return Ok(entries);
    }

    // Fall back to our native format (simple array)
    serde_json::from_str::<Vec<WorldInfoEntry>>(contents)
        .map_err(|e| format!("Failed to parse World Info: {}", e))
}

// Import World Info entries from JSON
#[tauri::command]
async fn import_world_info(
    app_handle: tauri::AppHandle,
    character_id: String,
    merge: bool,
) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file picker for JSON files
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("World Info", &["json"])
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

    // Read and parse world info file (supports both our format and SillyTavern format)
    let contents = fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let imported_entries = parse_world_info_json(&contents)?;

    let entry_count = imported_entries.len();

    // Load current settings
    let mut settings = load_roleplay_settings(&character_id);

    if merge {
        // Merge: Add imported entries to existing ones (regenerate IDs to avoid conflicts)
        for mut entry in imported_entries {
            entry.id = Uuid::new_v4().to_string(); // Generate new ID
            settings.world_info.push(entry);
        }
    } else {
        // Replace: Replace all world info with imported entries
        settings.world_info = imported_entries;
    }

    save_roleplay_settings(&character_id, &settings)?;

    Ok(entry_count)
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

// ============================================================================
// Branch Management Commands
// ============================================================================

#[tauri::command]
fn create_branch(message_index: usize, branch_name: String) -> Result<Branch, String> {
    let character = get_active_character();
    let mut branched = load_branched_history(&character.id);

    // Generate new branch ID
    let branch_id = Uuid::new_v4().to_string();

    // Get current branch messages
    let current_messages = branched.branch_messages
        .get(&branched.active_branch_id)
        .ok_or_else(|| "Active branch not found".to_string())?;

    // Validate message index
    if message_index > current_messages.len() {
        return Err(format!("Invalid message index: {}", message_index));
    }

    // Create new branch
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let new_branch = Branch {
        id: branch_id.clone(),
        name: branch_name,
        created_at: timestamp,
        parent_branch_id: Some(branched.active_branch_id.clone()),
        diverge_at_index: message_index,
    };

    // Copy messages up to divergence point
    let branch_messages: Vec<Message> = current_messages[..message_index].to_vec();

    // Add branch and its messages
    branched.branches.push(new_branch.clone());
    branched.branch_messages.insert(branch_id.clone(), branch_messages);

    // Save and return
    save_branched_history(&character.id, &branched)?;
    Ok(new_branch)
}

#[tauri::command]
fn switch_branch(branch_id: String) -> Result<Vec<Message>, String> {
    let character = get_active_character();
    let mut branched = load_branched_history(&character.id);

    // Verify branch exists
    if !branched.branch_messages.contains_key(&branch_id) {
        return Err(format!("Branch '{}' not found", branch_id));
    }

    // Switch active branch
    branched.active_branch_id = branch_id.clone();
    save_branched_history(&character.id, &branched)?;

    // Return messages for the new active branch
    let messages = branched.branch_messages
        .get(&branch_id)
        .cloned()
        .unwrap_or_default();

    Ok(messages)
}

#[tauri::command]
fn delete_branch(branch_id: String) -> Result<(), String> {
    let character = get_active_character();
    let mut branched = load_branched_history(&character.id);

    // Cannot delete main branch
    if branch_id == "main" {
        return Err("Cannot delete main branch".to_string());
    }

    // Cannot delete active branch
    if branch_id == branched.active_branch_id {
        return Err("Cannot delete active branch. Switch to another branch first.".to_string());
    }

    // Remove branch
    branched.branches.retain(|b| b.id != branch_id);
    branched.branch_messages.remove(&branch_id);

    // Also remove any child branches that depended on this one
    let mut branches_to_remove = vec![];
    for branch in &branched.branches {
        if branch.parent_branch_id.as_ref() == Some(&branch_id) {
            branches_to_remove.push(branch.id.clone());
        }
    }

    for child_id in branches_to_remove {
        branched.branches.retain(|b| b.id != child_id);
        branched.branch_messages.remove(&child_id);
    }

    save_branched_history(&character.id, &branched)?;
    Ok(())
}

#[tauri::command]
fn list_branches() -> Result<Vec<Branch>, String> {
    let character = get_active_character();
    let branched = load_branched_history(&character.id);
    Ok(branched.branches)
}

#[tauri::command]
fn rename_branch(branch_id: String, new_name: String) -> Result<(), String> {
    let character = get_active_character();
    let mut branched = load_branched_history(&character.id);

    // Find and rename the branch
    let branch = branched.branches.iter_mut()
        .find(|b| b.id == branch_id)
        .ok_or_else(|| format!("Branch '{}' not found", branch_id))?;

    branch.name = new_name;
    save_branched_history(&character.id, &branched)?;
    Ok(())
}

#[tauri::command]
fn get_active_branch_id() -> Result<String, String> {
    let character = get_active_character();
    let branched = load_branched_history(&character.id);
    Ok(branched.active_branch_id)
}

#[tauri::command]
fn get_branch_info(branch_id: String) -> Result<Branch, String> {
    let character = get_active_character();
    let branched = load_branched_history(&character.id);

    branched.branches.iter()
        .find(|b| b.id == branch_id)
        .cloned()
        .ok_or_else(|| format!("Branch '{}' not found", branch_id))
}

// ============================================================================
// Expression System Commands
// ============================================================================

// Helper function to get expressions directory for a character
fn get_expressions_dir(character_id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".config/claudia/expressions").join(character_id)
}

// Helper function to get expression image path
fn get_expression_path(character_id: &str, expression_filename: &str) -> PathBuf {
    get_expressions_dir(character_id).join(expression_filename)
}

#[tauri::command]
fn get_character_expressions(character_id: String) -> Result<HashMap<String, String>, String> {
    let characters = list_characters()?;
    if let Some(character) = characters.iter().find(|c| c.id == character_id) {
        Ok(character.expressions.clone())
    } else {
        Err(format!("Character {} not found", character_id))
    }
}

#[tauri::command]
fn upload_expression_image(source_path: String, character_id: String, expression_name: String) -> Result<String, String> {
    // Create expressions directory if it doesn't exist
    let expressions_dir = get_expressions_dir(&character_id);
    fs::create_dir_all(&expressions_dir).map_err(|e| e.to_string())?;

    // Determine file extension
    let source = PathBuf::from(&source_path);
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    // Create filename: expression_name.extension
    let filename = format!("{}.{}", expression_name, extension);
    let dest_path = expressions_dir.join(&filename);

    // Copy the file
    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    // Update character's expressions map
    let character = load_character(&character_id)
        .ok_or_else(|| format!("Character {} not found", character_id))?;

    let mut char_mut = character;
    char_mut.expressions.insert(expression_name.clone(), filename.clone());
    save_character(&char_mut)?;

    Ok(filename)
}

#[tauri::command]
async fn select_and_upload_expression(
    app_handle: tauri::AppHandle,
    character_id: String,
    expression_name: String
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        let path_str = path.as_path()
            .ok_or_else(|| "Could not get file path".to_string())?
            .to_string_lossy()
            .to_string();
        upload_expression_image(path_str, character_id, expression_name)
    } else {
        Err("No file selected".to_string())
    }
}

#[tauri::command]
fn delete_expression(character_id: String, expression_name: String) -> Result<(), String> {
    let mut character = load_character(&character_id)
        .ok_or_else(|| format!("Character {} not found", character_id))?;

    if let Some(filename) = character.expressions.remove(&expression_name) {
        // Delete the image file
        let file_path = get_expression_path(&character_id, &filename);
        if file_path.exists() {
            fs::remove_file(file_path).map_err(|e| e.to_string())?;
        }
        // Save updated character
        save_character(&character)?;
        Ok(())
    } else {
        Err(format!("Expression '{}' not found for character", expression_name))
    }
}

#[tauri::command]
fn get_expression_full_path(character_id: String, expression_filename: String) -> Result<String, String> {
    let path = get_expression_path(&character_id, &expression_filename);
    if path.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err(format!("Expression file not found: {}", expression_filename))
    }
}

#[tauri::command]
fn set_message_expression(message_index: usize, expression_name: Option<String>) -> Result<(), String> {
    let character = get_active_character();
    let mut history = load_history(&character.id);

    if message_index >= history.messages.len() {
        return Err(format!("Message index {} out of range", message_index));
    }

    history.messages[message_index].expression = expression_name;
    save_history(&character.id, &history)
}

#[tauri::command]
fn set_default_expression(character_id: String, expression_name: Option<String>) -> Result<(), String> {
    let mut character = load_character(&character_id)
        .ok_or_else(|| format!("Character {} not found", character_id))?;

    character.default_expression = expression_name;
    save_character(&character)
}

#[tauri::command]
fn detect_expression_from_text(text: String, available_expressions: Vec<String>) -> Option<String> {
    let text_lower = text.to_lowercase();

    // Happiness indicators
    if text_lower.contains("smile") || text_lower.contains("grin") ||
       text_lower.contains("laugh") || text_lower.contains("chuckle") ||
       text_lower.contains("happy") || text_lower.contains("joy") ||
       text_lower.contains("haha") || text_lower.contains("hehe") {
        if available_expressions.contains(&"happy".to_string()) {
            return Some("happy".to_string());
        }
    }

    // Sadness indicators
    if text_lower.contains("cry") || text_lower.contains("tear") ||
       text_lower.contains("sad") || text_lower.contains("depress") ||
       text_lower.contains("sorrow") || text_lower.contains("sob") {
        if available_expressions.contains(&"sad".to_string()) {
            return Some("sad".to_string());
        }
    }

    // Anger indicators
    if text_lower.contains("angry") || text_lower.contains("mad") ||
       text_lower.contains("furious") || text_lower.contains("rage") ||
       text_lower.contains("annoyed") || text_lower.contains("grr") {
        if available_expressions.contains(&"angry".to_string()) {
            return Some("angry".to_string());
        }
    }

    // Surprise indicators
    if text_lower.contains("surprise") || text_lower.contains("shock") ||
       text_lower.contains("gasp") || text_lower.contains("wow") ||
       text_lower.contains("omg") || text_lower.contains("amazing") {
        if available_expressions.contains(&"surprised".to_string()) {
            return Some("surprised".to_string());
        }
    }

    // Fear indicators
    if text_lower.contains("afraid") || text_lower.contains("scared") ||
       text_lower.contains("fear") || text_lower.contains("terror") ||
       text_lower.contains("frighten") {
        if available_expressions.contains(&"scared".to_string()) {
            return Some("scared".to_string());
        }
    }

    // Embarrassment indicators
    if text_lower.contains("blush") || text_lower.contains("embarrass") ||
       text_lower.contains("shy") || text_lower.contains("flustered") {
        if available_expressions.contains(&"embarrassed".to_string()) ||
           available_expressions.contains(&"blushing".to_string()) {
            return Some("embarrassed".to_string())
                .or(Some("blushing".to_string()));
        }
    }

    // Thinking/Confused indicators
    if text_lower.contains("think") || text_lower.contains("ponder") ||
       text_lower.contains("confused") || text_lower.contains("wonder") ||
       text_lower.contains("hmm") {
        if available_expressions.contains(&"thinking".to_string()) {
            return Some("thinking".to_string());
        }
    }

    // No match found
    None
}

// ============================================================================
// Plugin System Commands
// ============================================================================

#[tauri::command]
fn install_plugin(repo_url: String) -> Result<plugin_manager::Plugin, String> {
    plugin_manager::install_from_git(&repo_url)
}

#[tauri::command]
fn list_plugins() -> Vec<plugin_manager::Plugin> {
    plugin_manager::list_plugins()
}

#[tauri::command]
fn enable_plugin(plugin_id: String) -> Result<(), String> {
    plugin_manager::enable_plugin(&plugin_id)
}

#[tauri::command]
fn disable_plugin(plugin_id: String) -> Result<(), String> {
    plugin_manager::disable_plugin(&plugin_id)
}

#[tauri::command]
fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    plugin_manager::uninstall_plugin(&plugin_id)
}

#[tauri::command]
fn update_plugin(plugin_id: String) -> Result<(), String> {
    plugin_manager::update_plugin(&plugin_id)
}

#[tauri::command]
fn get_plugin(plugin_id: String) -> Option<plugin_manager::Plugin> {
    plugin_manager::get_plugin(&plugin_id)
}

#[tauri::command]
fn load_plugins() -> Result<String, String> {
    plugin_manager::load_enabled_plugins()
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
            delete_message_at_index,
            toggle_message_pin,
            toggle_message_hidden,
            get_message_at_index,
            insert_message_at_index,
            replace_messages_from_index,
            continue_message,
            regenerate_at_index,
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
            get_character_expressions,
            upload_expression_image,
            select_and_upload_expression,
            delete_expression,
            get_expression_full_path,
            set_message_expression,
            set_default_expression,
            detect_expression_from_text,
            export_chat_history,
            export_chat_as_markdown,
            export_chat_as_text,
            export_chat_as_html,
            import_chat_history,
            get_roleplay_settings,
            validate_regex_pattern,
            update_roleplay_depths,
            update_authors_note,
            update_persona,
            update_examples_settings,
            update_recursion_depth,
            get_presets,
            get_preset,
            set_active_preset,
            save_custom_preset,
            update_preset_instructions,
            delete_custom_preset,
            duplicate_preset,
            is_builtin_preset_modified,
            restore_builtin_preset,
            get_token_count,
            add_world_info_entry,
            update_world_info_entry,
            delete_world_info_entry,
            export_world_info,
            import_world_info,
            create_branch,
            switch_branch,
            delete_branch,
            list_branches,
            rename_branch,
            get_active_branch_id,
            get_branch_info,
            install_plugin,
            list_plugins,
            enable_plugin,
            disable_plugin,
            uninstall_plugin,
            update_plugin,
            get_plugin,
            load_plugins
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
