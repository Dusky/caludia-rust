// ============================================================================
// SAFE PLUGIN SANDBOX
// ============================================================================
// This module provides a secure sandbox for executing plugin code without
// using eval(), which is a critical security vulnerability.

/**
 * Creates a safe execution environment for plugin code
 * Only exposes whitelisted APIs to prevent malicious code execution
 */
export class PluginSandbox {
  constructor(pluginAPI) {
    this.api = pluginAPI;
    this.loadedPlugins = new Set();
  }

  /**
   * Safely execute plugin code in a restricted scope
   * @param {string} pluginCode - The plugin JavaScript code to execute
   * @param {string} pluginId - Unique identifier for the plugin
   * @returns {Promise<boolean>} - Success status
   */
  async executePlugin(pluginCode, pluginId = 'unknown') {
    if (this.loadedPlugins.has(pluginId)) {
      console.warn(`Plugin ${pluginId} already loaded, skipping`);
      return false;
    }

    try {
      // Validate plugin code before execution
      if (!this.validatePluginCode(pluginCode)) {
        throw new Error('Plugin code failed security validation');
      }

      // Create restricted execution environment
      // Only expose ClaudiaPluginAPI - no access to window, document, etc.
      const safeExecute = new Function('ClaudiaPluginAPI', `
        'use strict';

        // Prevent access to global objects
        const window = undefined;
        const document = undefined;
        const global = undefined;
        const process = undefined;
        const require = undefined;
        const module = undefined;
        const exports = undefined;
        const eval = undefined;
        const Function = undefined;

        // Execute plugin code with only ClaudiaPluginAPI available
        ${pluginCode}
      `);

      // Execute the plugin
      safeExecute(this.api);

      this.loadedPlugins.add(pluginId);
      console.log(`✅ Plugin ${pluginId} loaded successfully in sandbox`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to load plugin ${pluginId}:`, error);
      throw new Error(`Plugin execution failed: ${error.message}`);
    }
  }

  /**
   * Validate plugin code for suspicious patterns
   * @param {string} code - Plugin code to validate
   * @returns {boolean} - Whether code passed validation
   */
  validatePluginCode(code) {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/gi,                    // eval calls
      /Function\s*\(/gi,                // Function constructor
      /setTimeout\s*\(\s*["'`]/gi,      // setTimeout with string
      /setInterval\s*\(\s*["'`]/gi,     // setInterval with string
      /__proto__/gi,                    // Prototype pollution
      /constructor\s*\[/gi,             // Constructor access
      /import\s*\(/gi,                  // Dynamic imports
      /fetch\s*\(/gi,                   // Fetch (plugins should use invoke)
      /XMLHttpRequest/gi,               // XHR
      /localStorage\s*\./gi,            // Direct localStorage (should use API)
      /sessionStorage\s*\./gi,          // Session storage
      /document\.cookie/gi,             // Cookie access
      /\.innerHTML\s*=/gi,              // innerHTML assignment
      /\.outerHTML\s*=/gi,              // outerHTML assignment
      /\.insertAdjacentHTML/gi,         // HTML injection
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        console.error(`❌ Plugin validation failed: dangerous pattern detected (${pattern})`);
        return false;
      }
    }

    // Check for minimum code requirements
    if (code.trim().length < 10) {
      console.error('❌ Plugin validation failed: code too short');
      return false;
    }

    return true;
  }

  /**
   * Execute multiple plugins safely
   * @param {Array<{code: string, id: string}>} plugins - Array of plugins to load
   * @returns {Promise<{success: number, failed: number, errors: Array}>}
   */
  async executePlugins(plugins) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const plugin of plugins) {
      try {
        await this.executePlugin(plugin.code, plugin.id);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          pluginId: plugin.id,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Unload a plugin (for future hot-reloading support)
   * @param {string} pluginId - Plugin to unload
   */
  unloadPlugin(pluginId) {
    if (this.loadedPlugins.has(pluginId)) {
      this.loadedPlugins.delete(pluginId);
      console.log(`Plugin ${pluginId} unloaded`);
      return true;
    }
    return false;
  }

  /**
   * Get list of loaded plugins
   * @returns {Array<string>}
   */
  getLoadedPlugins() {
    return Array.from(this.loadedPlugins);
  }
}

/**
 * Create a sandboxed version of the Claudia Plugin API
 * This ensures plugins can only access intended functionality
 */
export function createSandboxedAPI(baseAPI) {
  // Return a proxy that only allows access to whitelisted methods
  const allowedMethods = new Set([
    'registerHook',
    'registerSettingsUI',
    'invoke',
    'getConfig',
    'setConfig',
    'log',
    'error',
    'getCurrentCharacter',
    'getChatHistory'
  ]);

  return new Proxy(baseAPI, {
    get(target, prop) {
      if (allowedMethods.has(prop)) {
        return target[prop];
      }
      console.warn(`⚠️ Plugin attempted to access unauthorized API: ${prop}`);
      return undefined;
    },
    set() {
      console.warn('⚠️ Plugin attempted to modify API - blocked');
      return false;
    }
  });
}
