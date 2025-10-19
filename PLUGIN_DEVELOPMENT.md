# Claudia Plugin Development Guide

Welcome to the Claudia plugin development guide! This document will help you create powerful extensions for Claudia.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Plugin Structure](#plugin-structure)
3. [Plugin Manifest](#plugin-manifest)
4. [ClaudiaPluginAPI](#claudiapluginapi)
5. [Available Hooks](#available-hooks)
6. [Examples](#examples)
7. [Publishing Your Plugin](#publishing-your-plugin)
8. [Best Practices](#best-practices)

## Getting Started

Claudia plugins are JavaScript modules that extend the functionality of Claudia. They can:
- Intercept and modify messages before they're sent
- Process AI responses
- Add custom commands
- Register new AI backends
- Add custom export formats
- Modify the conversation context
- Add UI components

### Prerequisites

- Basic JavaScript knowledge
- A GitHub account (for publishing)
- Git installed on your system

### Quick Start

1. Create a new directory for your plugin
2. Add a `plugin.json` manifest file
3. Create an `index.js` file with your plugin code
4. Initialize a Git repository
5. Push to GitHub
6. Install in Claudia using the Plugins settings tab

## Plugin Structure

A basic plugin consists of at least two files:

```
my-plugin/
├── plugin.json      # Plugin manifest (required)
├── index.js         # Main plugin code (required)
└── README.md        # Documentation (recommended)
```

## Plugin Manifest

The `plugin.json` file describes your plugin:

```json
{
  "id": "my-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A brief description of what your plugin does",
  "main": "index.js",
  "repository": "https://github.com/username/plugin-name",
  "permissions": [
    "message.intercept",
    "context.modify"
  ],
  "dependencies": {}
}
```

### Required Fields

- **id**: Unique identifier for your plugin (lowercase, hyphens only)
- **name**: Human-readable name
- **version**: Semantic version (e.g., "1.0.0")
- **author**: Your name or organization
- **description**: Brief description of functionality
- **main**: Entry point JavaScript file (usually "index.js")

### Optional Fields

- **repository**: GitHub repository URL
- **permissions**: Array of requested permissions
- **dependencies**: Object mapping plugin IDs to version ranges

## ClaudiaPluginAPI

All plugins have access to the global `ClaudiaPluginAPI` object, which provides methods to interact with Claudia.

### Available Plugin Metadata

Within your plugin code, you have access to:

- `PLUGIN_ID`: Your plugin's unique ID
- `PLUGIN_NAME`: Your plugin's name
- `PLUGIN_VERSION`: Your plugin's version

### API Methods

#### registerHook(hookName, callback)

Register a function to be called when a specific event occurs.

```javascript
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  // Modify or replace the message
  return modifiedMessage;
});
```

**Parameters:**
- `hookName` (string): Name of the hook to register
- `callback` (function): Async function to handle the event

**Returns:** `boolean` - true if successful, false if hook doesn't exist

#### invoke(command, params)

Call Tauri backend commands.

```javascript
const result = await ClaudiaPluginAPI.invoke('get_chat_history', {});
```

**Parameters:**
- `command` (string): Tauri command name
- `params` (object): Parameters to pass to the command

**Returns:** Promise resolving to command result

#### getConfig(pluginId, key)

Get a stored configuration value for your plugin.

```javascript
const setting = await ClaudiaPluginAPI.getConfig(PLUGIN_ID, 'my-setting');
```

**Parameters:**
- `pluginId` (string): Your plugin's ID
- `key` (string): Configuration key

**Returns:** Promise resolving to stored value or null

#### setConfig(pluginId, key, value)

Store a configuration value for your plugin.

```javascript
ClaudiaPluginAPI.setConfig(PLUGIN_ID, 'my-setting', { enabled: true });
```

**Parameters:**
- `pluginId` (string): Your plugin's ID
- `key` (string): Configuration key
- `value` (any): Value to store (will be JSON serialized)

#### log(pluginId, message)

Log an informational message.

```javascript
ClaudiaPluginAPI.log(PLUGIN_ID, 'Plugin initialized successfully');
```

#### error(pluginId, message)

Log an error message.

```javascript
ClaudiaPluginAPI.error(PLUGIN_ID, 'Failed to process command');
```

#### getCurrentCharacter()

Get the current character object.

```javascript
const character = ClaudiaPluginAPI.getCurrentCharacter();
console.log(character.name);
```

**Returns:** Current character object or null

#### getChatHistory()

Get the full chat history.

```javascript
const history = await ClaudiaPluginAPI.getChatHistory();
```

**Returns:** Promise resolving to chat history array

## Available Hooks

### beforeMessageSend

Called before a user message is sent to the AI. You can modify or replace the message.

```javascript
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  // message: string
  // Return modified message or original
  return message;
});
```

**Use cases:**
- Add custom commands (e.g., `/roll`, `/search`)
- Auto-format messages
- Add context or metadata
- Implement shortcuts

### afterMessageReceive

Called after receiving a response from the AI, before it's displayed.

```javascript
ClaudiaPluginAPI.registerHook('afterMessageReceive', async (response) => {
  // response: string
  // Return modified response or original
  return response;
});
```

**Use cases:**
- Post-process AI responses
- Parse and format special syntax
- Add links or references
- Filter content

### onMessageDisplay

Called when a message is about to be displayed in the UI.

```javascript
ClaudiaPluginAPI.registerHook('onMessageDisplay', async (messageData) => {
  // messageData: { content: string, isUser: boolean, timestamp: number }
  // Return modified messageData or original
  return messageData;
});
```

**Use cases:**
- Custom message rendering
- Add metadata badges
- Syntax highlighting
- Emoji reactions

### registerAIBackend

Register a custom AI backend provider.

```javascript
ClaudiaPluginAPI.registerHook('registerAIBackend', async (backends) => {
  // backends: array of backend definitions
  backends.push({
    id: 'my-backend',
    name: 'My Custom AI',
    handler: async (message, context) => {
      // Return AI response
      return 'Response from custom AI';
    }
  });
  return backends;
});
```

**Use cases:**
- Add support for new AI APIs
- Implement local AI models
- Create custom response generators

### registerExportFormat

Register a custom export format.

```javascript
ClaudiaPluginAPI.registerHook('registerExportFormat', async (formats) => {
  formats.push({
    id: 'my-format',
    name: 'My Custom Format',
    extension: '.myformat',
    handler: async (chatHistory) => {
      // Return formatted content
      return 'Formatted chat history';
    }
  });
  return formats;
});
```

**Use cases:**
- Export to custom file formats
- Integration with external tools
- Specialized formatting

### modifyContext

Modify the conversation context before sending to the AI.

```javascript
ClaudiaPluginAPI.registerHook('modifyContext', async (context) => {
  // context: { system: string, messages: array, ... }
  // Return modified context
  return context;
});
```

**Use cases:**
- Add dynamic system prompts
- Inject world info
- Add time/date context
- Implement memory systems

### addUIComponent

Add custom UI components to the interface.

```javascript
ClaudiaPluginAPI.registerHook('addUIComponent', async (components) => {
  components.push({
    id: 'my-component',
    location: 'sidebar', // or 'header', 'footer', 'message-toolbar'
    html: '<div>My Custom Component</div>',
    handlers: {
      onClick: () => console.log('Clicked!')
    }
  });
  return components;
});
```

**Use cases:**
- Add custom buttons or controls
- Display plugin status
- Quick action menus

## Examples

### Example 1: Simple Command Plugin

```javascript
// Dice Roller Plugin
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  if (message.startsWith('/roll ')) {
    const dice = message.substring(6); // Remove "/roll "
    const match = dice.match(/^(\d+)d(\d+)$/);

    if (match) {
      const count = parseInt(match[1]);
      const sides = parseInt(match[2]);
      const rolls = [];

      for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(Math.random() * sides) + 1);
      }

      const total = rolls.reduce((a, b) => a + b, 0);
      return `🎲 Rolled ${dice}: [${rolls.join(', ')}] = ${total}`;
    }
  }
  return message;
});
```

### Example 2: Response Formatter

```javascript
// Code Block Formatter Plugin
ClaudiaPluginAPI.registerHook('afterMessageReceive', async (response) => {
  // Automatically format code blocks with syntax highlighting
  return response.replace(/```(\w+)\n([\s\S]+?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code}</code></pre>`;
  });
});
```

### Example 3: Context Enhancer

```javascript
// Time Context Plugin
ClaudiaPluginAPI.registerHook('modifyContext', async (context) => {
  const now = new Date();
  const timeInfo = `Current date and time: ${now.toLocaleString()}`;

  // Add time information to system prompt
  context.system = `${context.system}\n\n${timeInfo}`;

  return context;
});
```

### Example 4: Persistent Settings

```javascript
// Theme Plugin with Settings
const DEFAULT_THEME = 'dark';

// Load saved theme
const savedTheme = await ClaudiaPluginAPI.getConfig(PLUGIN_ID, 'theme') || DEFAULT_THEME;

// Apply theme
document.body.setAttribute('data-plugin-theme', savedTheme);

// Save theme when changed
function setTheme(theme) {
  ClaudiaPluginAPI.setConfig(PLUGIN_ID, 'theme', theme);
  document.body.setAttribute('data-plugin-theme', theme);
}
```

## Publishing Your Plugin

### 1. Create a Git Repository

```bash
cd my-plugin
git init
git add .
git commit -m "Initial commit"
```

### 2. Push to GitHub

```bash
git remote add origin https://github.com/username/my-plugin.git
git push -u origin master
```

### 3. Installation

Users can install your plugin by:
1. Opening Claudia Settings
2. Going to the Plugins tab
3. Entering your repository URL: `https://github.com/username/my-plugin`
4. Clicking "Install"

### 4. Version Updates

When you release updates:
1. Update the version in `plugin.json`
2. Commit and push changes
3. Users can click "Update" in the Plugins tab to get the latest version

## Best Practices

### Error Handling

Always handle errors gracefully:

```javascript
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  try {
    // Your plugin logic here
    return processMessage(message);
  } catch (error) {
    ClaudiaPluginAPI.error(PLUGIN_ID, `Error processing message: ${error.message}`);
    return message; // Pass through original on error
  }
});
```

### Performance

- Keep hook handlers fast and efficient
- Avoid blocking operations
- Use async/await for I/O operations
- Cache expensive computations

### Compatibility

- Always return the expected data type from hooks
- Test with different types of messages and content
- Don't assume specific Claudia internal structure
- Use the API, don't access internal variables

### Security

- Validate all user input
- Don't execute arbitrary code from messages
- Be careful with external API calls
- Don't store sensitive data in localStorage without encryption

### User Experience

- Provide clear error messages
- Add helpful documentation in README
- Use logging for debugging
- Respect user preferences

### Code Quality

```javascript
// Good: Clear, documented, handles errors
ClaudiaPluginAPI.registerHook('beforeMessageSend', async (message) => {
  // Check if this is our command
  if (!message.startsWith('/mycommand')) {
    return message; // Pass through
  }

  try {
    // Process command
    const result = await processMyCommand(message);
    ClaudiaPluginAPI.log(PLUGIN_ID, `Processed command successfully`);
    return result;
  } catch (error) {
    ClaudiaPluginAPI.error(PLUGIN_ID, `Command failed: ${error.message}`);
    return `Error: ${error.message}`;
  }
});
```

## Testing Your Plugin

### Local Testing

1. Create your plugin in a local directory
2. Initialize as Git repository
3. Install using the local path: `file:///path/to/your/plugin`
4. Enable the plugin
5. Reload Claudia
6. Test your functionality

### Debugging

Use the browser console (F12) to:
- View `ClaudiaPluginAPI.log()` messages
- See error output
- Test plugin functions directly

```javascript
// In browser console:
ClaudiaPluginAPI.getConfig('my-plugin', 'setting')
```

## Support and Community

- Report issues on the Claudia GitHub repository
- Share your plugins in the community showcase
- Contribute examples and improvements to this documentation

## License

When creating plugins, choose an appropriate open-source license. MIT and Apache 2.0 are popular choices.

---

Happy plugin development! We can't wait to see what you create.
