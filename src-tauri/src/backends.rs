// ============================================================================
// BACKEND ABSTRACTION LAYER
// ============================================================================
// Unified interface for multiple AI backends (Anthropic, OpenAI, Kobold, etc.)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Backend type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackendType {
    Anthropic,
    OpenAI,
    OpenAICompatible, // Generic OpenAI-compatible (LM Studio, LocalAI, etc.)
    Kobold,           // KoboldCpp, KoboldAI
    Oobabooga,        // Text generation WebUI
    Ollama,           // Ollama local models
    LMStudio,         // LM Studio
    TabbyAPI,         // TabbyAPI
    Custom,           // User-defined
}

impl Default for BackendType {
    fn default() -> Self {
        BackendType::Anthropic
    }
}

impl BackendType {
    /// Get default base URL for this backend type
    pub fn default_base_url(&self) -> &str {
        match self {
            BackendType::Anthropic => "https://api.anthropic.com",
            BackendType::OpenAI => "https://api.openai.com/v1",
            BackendType::Kobold => "http://localhost:5001",
            BackendType::Oobabooga => "http://localhost:5000",
            BackendType::Ollama => "http://localhost:11434",
            BackendType::LMStudio => "http://localhost:1234/v1",
            BackendType::TabbyAPI => "http://localhost:5000/v1",
            BackendType::OpenAICompatible | BackendType::Custom => "",
        }
    }

    /// Get default model for this backend type
    pub fn default_model(&self) -> &str {
        match self {
            BackendType::Anthropic => "claude-3-5-sonnet-20241022",
            BackendType::OpenAI => "gpt-4-turbo-preview",
            BackendType::Ollama => "llama3.2",
            BackendType::LMStudio => "local-model",
            _ => "",
        }
    }

    /// Whether this backend requires an API key
    pub fn requires_api_key(&self) -> bool {
        matches!(self, BackendType::Anthropic | BackendType::OpenAI)
    }

    /// Get the API endpoint path for chat completions
    pub fn chat_endpoint(&self) -> &str {
        match self {
            BackendType::Anthropic => "/v1/messages",
            BackendType::OpenAI | BackendType::OpenAICompatible | BackendType::LMStudio | BackendType::TabbyAPI => {
                "/chat/completions"
            }
            BackendType::Kobold => "/api/v1/generate",
            BackendType::Oobabooga => "/api/v1/chat/completions",
            BackendType::Ollama => "/api/chat",
            BackendType::Custom => "/chat/completions",
        }
    }

    /// Whether this backend supports streaming
    pub fn supports_streaming(&self) -> bool {
        match self {
            BackendType::Custom => false, // Unknown
            _ => true,
        }
    }

    /// Get request format for this backend
    pub fn request_format(&self) -> RequestFormat {
        match self {
            BackendType::Anthropic => RequestFormat::Anthropic,
            BackendType::OpenAI
            | BackendType::OpenAICompatible
            | BackendType::Oobabooga
            | BackendType::LMStudio
            | BackendType::TabbyAPI => RequestFormat::OpenAI,
            BackendType::Kobold => RequestFormat::Kobold,
            BackendType::Ollama => RequestFormat::Ollama,
            BackendType::Custom => RequestFormat::OpenAI, // Assume OpenAI-compatible
        }
    }
}

/// Request format type
#[derive(Debug, Clone, PartialEq)]
pub enum RequestFormat {
    Anthropic,
    OpenAI,
    Kobold,
    Ollama,
}

/// Sampling parameters for text generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingParams {
    // Core parameters (supported by most backends)
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    #[serde(default = "default_top_p")]
    pub top_p: f32,

    #[serde(default = "default_top_k")]
    pub top_k: u32,

    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,

    // Advanced parameters
    #[serde(default)]
    pub min_p: Option<f32>,

    #[serde(default)]
    pub top_a: Option<f32>,

    #[serde(default)]
    pub typical_p: Option<f32>,

    #[serde(default)]
    pub tfs: Option<f32>, // Tail-free sampling

    #[serde(default)]
    pub repetition_penalty: Option<f32>,

    #[serde(default)]
    pub frequency_penalty: Option<f32>,

    #[serde(default)]
    pub presence_penalty: Option<f32>,

    #[serde(default)]
    pub repetition_penalty_range: Option<u32>,

    // Mirostat sampling
    #[serde(default)]
    pub mirostat_mode: Option<u8>, // 0, 1, or 2

    #[serde(default)]
    pub mirostat_tau: Option<f32>,

    #[serde(default)]
    pub mirostat_eta: Option<f32>,

    // Stop sequences
    #[serde(default)]
    pub stop_sequences: Vec<String>,

    // Other
    #[serde(default)]
    pub seed: Option<u64>,
}

fn default_temperature() -> f32 {
    1.0
}

fn default_top_p() -> f32 {
    1.0
}

fn default_top_k() -> u32 {
    0
}

fn default_max_tokens() -> u32 {
    2048
}

impl Default for SamplingParams {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            top_p: default_top_p(),
            top_k: default_top_k(),
            max_tokens: default_max_tokens(),
            min_p: None,
            top_a: None,
            typical_p: None,
            tfs: None,
            repetition_penalty: None,
            frequency_penalty: None,
            presence_penalty: None,
            repetition_penalty_range: None,
            mirostat_mode: None,
            mirostat_tau: None,
            mirostat_eta: None,
            stop_sequences: Vec::new(),
            seed: None,
        }
    }
}

impl SamplingParams {
    /// Get parameters as a HashMap for API requests
    pub fn to_map(&self, format: &RequestFormat) -> HashMap<String, serde_json::Value> {
        let mut map = HashMap::new();

        // Core parameters (all formats)
        map.insert("temperature".to_string(), serde_json::json!(self.temperature));
        map.insert("max_tokens".to_string(), serde_json::json!(self.max_tokens));

        match format {
            RequestFormat::OpenAI => {
                map.insert("top_p".to_string(), serde_json::json!(self.top_p));
                if let Some(freq) = self.frequency_penalty {
                    map.insert("frequency_penalty".to_string(), serde_json::json!(freq));
                }
                if let Some(pres) = self.presence_penalty {
                    map.insert("presence_penalty".to_string(), serde_json::json!(pres));
                }
                if !self.stop_sequences.is_empty() {
                    map.insert("stop".to_string(), serde_json::json!(self.stop_sequences));
                }
                if let Some(seed) = self.seed {
                    map.insert("seed".to_string(), serde_json::json!(seed));
                }
            }
            RequestFormat::Anthropic => {
                map.insert("top_p".to_string(), serde_json::json!(self.top_p));
                map.insert("top_k".to_string(), serde_json::json!(self.top_k));
                if !self.stop_sequences.is_empty() {
                    map.insert("stop_sequences".to_string(), serde_json::json!(self.stop_sequences));
                }
            }
            RequestFormat::Kobold | RequestFormat::Ollama => {
                map.insert("top_p".to_string(), serde_json::json!(self.top_p));
                map.insert("top_k".to_string(), serde_json::json!(self.top_k));
                if let Some(rep) = self.repetition_penalty {
                    map.insert("rep_pen".to_string(), serde_json::json!(rep));
                }
                if let Some(range) = self.repetition_penalty_range {
                    map.insert("rep_pen_range".to_string(), serde_json::json!(range));
                }
                if let Some(min_p) = self.min_p {
                    map.insert("min_p".to_string(), serde_json::json!(min_p));
                }
                if let Some(tfs) = self.tfs {
                    map.insert("tfs".to_string(), serde_json::json!(tfs));
                }
                if let Some(typical) = self.typical_p {
                    map.insert("typical".to_string(), serde_json::json!(typical));
                }
                if let Some(mode) = self.mirostat_mode {
                    map.insert("mirostat_mode".to_string(), serde_json::json!(mode));
                    if let Some(tau) = self.mirostat_tau {
                        map.insert("mirostat_tau".to_string(), serde_json::json!(tau));
                    }
                    if let Some(eta) = self.mirostat_eta {
                        map.insert("mirostat_eta".to_string(), serde_json::json!(eta));
                    }
                }
                if !self.stop_sequences.is_empty() {
                    map.insert("stop_sequence".to_string(), serde_json::json!(self.stop_sequences));
                }
            }
        }

        map
    }
}

/// Sampling preset - predefined sampling parameter configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub params: SamplingParams,
    #[serde(default)]
    pub is_builtin: bool,
}

impl SamplingPreset {
    /// Get built-in sampling presets
    pub fn builtin_presets() -> Vec<SamplingPreset> {
        vec![
            // Balanced - Default settings
            SamplingPreset {
                id: "balanced".to_string(),
                name: "Balanced".to_string(),
                description: "Balanced settings for general use".to_string(),
                params: SamplingParams {
                    temperature: 1.0,
                    top_p: 1.0,
                    top_k: 0,
                    max_tokens: 2048,
                    min_p: None,
                    top_a: None,
                    typical_p: None,
                    tfs: None,
                    repetition_penalty: None,
                    frequency_penalty: None,
                    presence_penalty: None,
                    repetition_penalty_range: None,
                    mirostat_mode: None,
                    mirostat_tau: None,
                    mirostat_eta: None,
                    stop_sequences: Vec::new(),
                    seed: None,
                },
                is_builtin: true,
            },
            // Creative - High temperature for creative writing
            SamplingPreset {
                id: "creative".to_string(),
                name: "Creative".to_string(),
                description: "Higher temperature for creative and varied responses".to_string(),
                params: SamplingParams {
                    temperature: 1.2,
                    top_p: 0.95,
                    top_k: 0,
                    max_tokens: 2048,
                    min_p: Some(0.05),
                    top_a: None,
                    typical_p: None,
                    tfs: None,
                    repetition_penalty: Some(1.1),
                    frequency_penalty: Some(0.3),
                    presence_penalty: Some(0.3),
                    repetition_penalty_range: None,
                    mirostat_mode: None,
                    mirostat_tau: None,
                    mirostat_eta: None,
                    stop_sequences: Vec::new(),
                    seed: None,
                },
                is_builtin: true,
            },
            // Precise - Low temperature for factual responses
            SamplingPreset {
                id: "precise".to_string(),
                name: "Precise".to_string(),
                description: "Lower temperature for focused and deterministic responses".to_string(),
                params: SamplingParams {
                    temperature: 0.7,
                    top_p: 0.9,
                    top_k: 40,
                    max_tokens: 2048,
                    min_p: None,
                    top_a: None,
                    typical_p: None,
                    tfs: None,
                    repetition_penalty: None,
                    frequency_penalty: None,
                    presence_penalty: None,
                    repetition_penalty_range: None,
                    mirostat_mode: None,
                    mirostat_tau: None,
                    mirostat_eta: None,
                    stop_sequences: Vec::new(),
                    seed: None,
                },
                is_builtin: true,
            },
            // Roleplay - Optimized for character roleplay
            SamplingPreset {
                id: "roleplay".to_string(),
                name: "Roleplay".to_string(),
                description: "Optimized for immersive character roleplay".to_string(),
                params: SamplingParams {
                    temperature: 0.9,
                    top_p: 0.95,
                    top_k: 0,
                    max_tokens: 2048,
                    min_p: Some(0.05),
                    top_a: None,
                    typical_p: None,
                    tfs: None,
                    repetition_penalty: Some(1.15),
                    frequency_penalty: Some(0.2),
                    presence_penalty: Some(0.4),
                    repetition_penalty_range: None,
                    mirostat_mode: None,
                    mirostat_tau: None,
                    mirostat_eta: None,
                    stop_sequences: Vec::new(),
                    seed: None,
                },
                is_builtin: true,
            },
        ]
    }
}

/// Backend preset - predefined configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendPreset {
    pub name: String,
    pub backend_type: BackendType,
    pub base_url: String,
    pub description: String,
}

impl BackendPreset {
    /// Get built-in presets
    pub fn builtin_presets() -> Vec<BackendPreset> {
        vec![
            BackendPreset {
                name: "Anthropic Claude".to_string(),
                backend_type: BackendType::Anthropic,
                base_url: "https://api.anthropic.com".to_string(),
                description: "Anthropic's Claude models (Sonnet, Opus, Haiku)".to_string(),
            },
            BackendPreset {
                name: "OpenAI".to_string(),
                backend_type: BackendType::OpenAI,
                base_url: "https://api.openai.com/v1".to_string(),
                description: "OpenAI GPT models (GPT-4, GPT-3.5)".to_string(),
            },
            BackendPreset {
                name: "KoboldCpp (Local)".to_string(),
                backend_type: BackendType::Kobold,
                base_url: "http://localhost:5001".to_string(),
                description: "Local KoboldCpp server".to_string(),
            },
            BackendPreset {
                name: "Oobabooga (Local)".to_string(),
                backend_type: BackendType::Oobabooga,
                base_url: "http://localhost:5000".to_string(),
                description: "Text generation WebUI".to_string(),
            },
            BackendPreset {
                name: "LM Studio (Local)".to_string(),
                backend_type: BackendType::LMStudio,
                base_url: "http://localhost:1234/v1".to_string(),
                description: "LM Studio local server".to_string(),
            },
            BackendPreset {
                name: "Ollama (Local)".to_string(),
                backend_type: BackendType::Ollama,
                base_url: "http://localhost:11434".to_string(),
                description: "Ollama local models".to_string(),
            },
            BackendPreset {
                name: "TabbyAPI (Local)".to_string(),
                backend_type: BackendType::TabbyAPI,
                base_url: "http://localhost:5000/v1".to_string(),
                description: "TabbyAPI exllamav2 server".to_string(),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_defaults() {
        assert_eq!(
            BackendType::Anthropic.default_base_url(),
            "https://api.anthropic.com"
        );
        assert_eq!(BackendType::Anthropic.requires_api_key(), true);
        assert_eq!(BackendType::Kobold.requires_api_key(), false);
    }

    #[test]
    fn test_sampling_params_to_map() {
        let params = SamplingParams::default();
        let map = params.to_map(&RequestFormat::OpenAI);
        assert!(map.contains_key("temperature"));
        assert!(map.contains_key("max_tokens"));
    }

    #[test]
    fn test_builtin_presets() {
        let presets = BackendPreset::builtin_presets();
        assert!(presets.len() >= 5);
        assert!(presets.iter().any(|p| p.backend_type == BackendType::Anthropic));
    }
}
