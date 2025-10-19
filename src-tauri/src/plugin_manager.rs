use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// Plugin manifest structure (plugin.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub main: String,                      // Entry point JS file
    pub repository: Option<String>,         // GitHub URL
    pub permissions: Vec<String>,           // Requested permissions
    #[serde(default)]
    pub dependencies: HashMap<String, String>, // Other plugins this depends on
}

// Plugin metadata stored locally
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_at: i64,              // Unix timestamp
    pub updated_at: i64,
    pub local_path: String,             // Path to plugin directory
}

// Plugin registry (list of installed plugins)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginRegistry {
    pub plugins: HashMap<String, Plugin>, // Key: plugin.id
}

// Get the plugins directory path
pub fn get_plugins_dir() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("claudia");
    path.push("plugins");
    path
}

// Get the plugin registry file path
fn get_registry_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("claudia");
    path.push("plugin_registry.json");
    path
}

// Load the plugin registry from disk
pub fn load_registry() -> PluginRegistry {
    let path = get_registry_path();

    if !path.exists() {
        return PluginRegistry::default();
    }

    match fs::read_to_string(&path) {
        Ok(contents) => {
            serde_json::from_str(&contents).unwrap_or_default()
        }
        Err(_) => PluginRegistry::default(),
    }
}

// Save the plugin registry to disk
pub fn save_registry(registry: &PluginRegistry) -> Result<(), String> {
    let path = get_registry_path();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create registry directory: {}", e))?;
    }

    let contents = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;

    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write registry: {}", e))?;

    Ok(())
}

// Parse plugin.json manifest from a directory
pub fn parse_manifest(plugin_dir: &PathBuf) -> Result<PluginManifest, String> {
    let manifest_path = plugin_dir.join("plugin.json");

    if !manifest_path.exists() {
        return Err("plugin.json not found in plugin directory".to_string());
    }

    let contents = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read plugin.json: {}", e))?;

    let manifest: PluginManifest = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse plugin.json: {}", e))?;

    // Validate required fields
    if manifest.id.is_empty() {
        return Err("Plugin ID cannot be empty".to_string());
    }
    if manifest.name.is_empty() {
        return Err("Plugin name cannot be empty".to_string());
    }
    if manifest.main.is_empty() {
        return Err("Plugin main file cannot be empty".to_string());
    }

    Ok(manifest)
}

// Install a plugin from a Git repository
pub fn install_from_git(repo_url: &str) -> Result<Plugin, String> {
    use git2::Repository;

    // Parse plugin ID from repo URL (e.g., https://github.com/user/plugin-name -> plugin-name)
    let plugin_id = repo_url
        .rsplit('/')
        .next()
        .ok_or("Invalid repository URL")?
        .trim_end_matches(".git")
        .to_string();

    // Create plugins directory if it doesn't exist
    let plugins_dir = get_plugins_dir();
    fs::create_dir_all(&plugins_dir)
        .map_err(|e| format!("Failed to create plugins directory: {}", e))?;

    // Plugin installation path
    let plugin_dir = plugins_dir.join(&plugin_id);

    // Check if plugin already exists
    if plugin_dir.exists() {
        return Err(format!("Plugin '{}' is already installed", plugin_id));
    }

    // Clone the repository
    Repository::clone(repo_url, &plugin_dir)
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    // Parse the manifest
    let manifest = parse_manifest(&plugin_dir)?;

    // Create plugin metadata
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let plugin = Plugin {
        manifest,
        enabled: false, // Plugins start disabled by default
        installed_at: now,
        updated_at: now,
        local_path: plugin_dir.to_string_lossy().to_string(),
    };

    // Add to registry
    let mut registry = load_registry();
    registry.plugins.insert(plugin_id.clone(), plugin.clone());
    save_registry(&registry)?;

    Ok(plugin)
}

// Update a plugin by pulling from Git
pub fn update_plugin(plugin_id: &str) -> Result<(), String> {
    use git2::Repository;

    let registry = load_registry();
    let plugin = registry.plugins.get(plugin_id)
        .ok_or(format!("Plugin '{}' not found", plugin_id))?;

    let repo_path = PathBuf::from(&plugin.local_path);

    // Open the repository
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    // Fetch and pull
    let mut remote = repo.find_remote("origin")
        .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;

    remote.fetch(&["main"], None, None)
        .or_else(|_| remote.fetch(&["master"], None, None))
        .map_err(|e| format!("Failed to fetch from remote: {}", e))?;

    // For simplicity, we'll just do a hard reset to origin/main or origin/master
    // In production, you might want more sophisticated merge logic
    let fetch_head = repo.find_reference("FETCH_HEAD")
        .map_err(|e| format!("Failed to find FETCH_HEAD: {}", e))?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("Failed to analyze merge: {}", e))?;

    if analysis.is_up_to_date() {
        return Err("Plugin is already up to date".to_string());
    } else if analysis.is_fast_forward() {
        // Fast-forward merge
        let refname = "refs/heads/main";
        match repo.find_reference(refname) {
            Ok(mut r) => {
                r.set_target(fetch_commit.id(), "Fast-forward")
                    .map_err(|e| format!("Failed to fast-forward: {}", e))?;
                repo.set_head(refname)
                    .map_err(|e| format!("Failed to set HEAD: {}", e))?;
                repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                    .map_err(|e| format!("Failed to checkout: {}", e))?;
            }
            Err(_) => {
                // Try master branch
                let refname = "refs/heads/master";
                if let Ok(mut r) = repo.find_reference(refname) {
                    r.set_target(fetch_commit.id(), "Fast-forward")
                        .map_err(|e| format!("Failed to fast-forward: {}", e))?;
                    repo.set_head(refname)
                        .map_err(|e| format!("Failed to set HEAD: {}", e))?;
                    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                        .map_err(|e| format!("Failed to checkout: {}", e))?;
                }
            }
        }
    }

    // Update the timestamp
    let mut registry = load_registry();
    if let Some(plugin) = registry.plugins.get_mut(plugin_id) {
        plugin.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
    }
    save_registry(&registry)?;

    Ok(())
}

// Uninstall a plugin
pub fn uninstall_plugin(plugin_id: &str) -> Result<(), String> {
    let mut registry = load_registry();

    let plugin = registry.plugins.get(plugin_id)
        .ok_or(format!("Plugin '{}' not found", plugin_id))?;

    let plugin_path = PathBuf::from(&plugin.local_path);

    // Remove the plugin directory
    if plugin_path.exists() {
        fs::remove_dir_all(&plugin_path)
            .map_err(|e| format!("Failed to remove plugin directory: {}", e))?;
    }

    // Remove from registry
    registry.plugins.remove(plugin_id);
    save_registry(&registry)?;

    Ok(())
}

// Enable a plugin
pub fn enable_plugin(plugin_id: &str) -> Result<(), String> {
    let mut registry = load_registry();

    let plugin = registry.plugins.get_mut(plugin_id)
        .ok_or(format!("Plugin '{}' not found", plugin_id))?;

    plugin.enabled = true;
    save_registry(&registry)?;

    Ok(())
}

// Disable a plugin
pub fn disable_plugin(plugin_id: &str) -> Result<(), String> {
    let mut registry = load_registry();

    let plugin = registry.plugins.get_mut(plugin_id)
        .ok_or(format!("Plugin '{}' not found", plugin_id))?;

    plugin.enabled = false;
    save_registry(&registry)?;

    Ok(())
}

// Get all installed plugins
pub fn list_plugins() -> Vec<Plugin> {
    let registry = load_registry();
    registry.plugins.values().cloned().collect()
}

// Get a specific plugin
pub fn get_plugin(plugin_id: &str) -> Option<Plugin> {
    let registry = load_registry();
    registry.plugins.get(plugin_id).cloned()
}

// Load the JavaScript code for all enabled plugins
pub fn load_enabled_plugins() -> Result<String, String> {
    let registry = load_registry();
    let mut combined_js = String::new();

    for plugin in registry.plugins.values() {
        if !plugin.enabled {
            continue;
        }

        let plugin_dir = PathBuf::from(&plugin.local_path);
        let main_file = plugin_dir.join(&plugin.manifest.main);

        if !main_file.exists() {
            eprintln!("Warning: Plugin '{}' main file not found: {}", plugin.manifest.id, main_file.display());
            continue;
        }

        match fs::read_to_string(&main_file) {
            Ok(js_content) => {
                // Wrap plugin code in an IIFE with plugin metadata
                combined_js.push_str(&format!(
                    "\n\n// Plugin: {} ({})\n(function() {{\n  const PLUGIN_ID = '{}';\n  const PLUGIN_NAME = '{}';\n  const PLUGIN_VERSION = '{}';\n  \n{}\n}})();\n",
                    plugin.manifest.name,
                    plugin.manifest.version,
                    plugin.manifest.id,
                    plugin.manifest.name,
                    plugin.manifest.version,
                    js_content
                ));
            }
            Err(e) => {
                eprintln!("Warning: Failed to read plugin '{}': {}", plugin.manifest.id, e);
            }
        }
    }

    Ok(combined_js)
}
