// ============================================================================
// ERROR TYPES
// ============================================================================
// Centralized error handling for the Tauri backend
// Replaces string-based errors with typed errors for better handling

use std::fmt;

/// Main application error type
/// All Tauri commands should return Result<T, AppError>
#[derive(Debug, Clone)]
pub enum AppError {
    /// IO errors (file operations)
    Io(String),

    /// JSON serialization/deserialization errors
    Json(String),

    /// Character not found
    CharacterNotFound(String),

    /// Invalid input data
    InvalidInput(String),

    /// Configuration errors
    Config(String),

    /// API errors (Anthropic API)
    Api(String),

    /// Plugin errors
    Plugin(String),

    /// Database/storage errors
    Storage(String),

    /// Network errors
    Network(String),

    /// Unknown/unexpected errors
    Unknown(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(msg) => write!(f, "IO error: {}", msg),
            AppError::Json(msg) => write!(f, "JSON error: {}", msg),
            AppError::CharacterNotFound(msg) => write!(f, "Character not found: {}", msg),
            AppError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            AppError::Config(msg) => write!(f, "Configuration error: {}", msg),
            AppError::Api(msg) => write!(f, "API error: {}", msg),
            AppError::Plugin(msg) => write!(f, "Plugin error: {}", msg),
            AppError::Storage(msg) => write!(f, "Storage error: {}", msg),
            AppError::Network(msg) => write!(f, "Network error: {}", msg),
            AppError::Unknown(msg) => write!(f, "Unknown error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

// Implement From traits for automatic error conversion
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Json(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err.to_string())
    }
}

// Make AppError serializable for Tauri IPC
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Result type alias for convenience
pub type Result<T> = std::result::Result<T, AppError>;

/// Helper to convert Option<T> to Result<T, AppError>
pub trait OptionExt<T> {
    fn ok_or_app_error(self, error_msg: &str) -> Result<T>;
}

impl<T> OptionExt<T> for Option<T> {
    fn ok_or_app_error(self, error_msg: &str) -> Result<T> {
        self.ok_or_else(|| AppError::InvalidInput(error_msg.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AppError::CharacterNotFound("test-id".to_string());
        assert_eq!(err.to_string(), "Character not found: test-id");
    }

    #[test]
    fn test_io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::Io(_)));
    }
}
