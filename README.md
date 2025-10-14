# Claudia

Beautiful AI roleplay desktop companion built with Tauri and Rust.

## Vision

Claudia aims to be a lightweight, desktop-native alternative to SillyTavern, focusing on roleplay and character-based interactions while maintaining a clean, modern interface.

## Features

### Core Chat Features
- 🎨 **Beautiful glassmorphic UI** - Modern design with gradient backgrounds
- 🔧 **Bring-your-own-API** - Supports any Anthropic-compatible API
- ✅ **API validation** - Automatic model detection via /v1/models
- 💬 **Full conversation context** - AI remembers your entire conversation
- 💾 **Persistent chat history** - Conversations saved per character
- 🎯 **Streaming responses** - Real-time token display (optional)

### Character System
- 🎭 **Multiple characters** - Switch between different AI personas
- 🖼️ **Character avatars** - Upload custom images with zoom preview
- 📇 **V2/V3 character cards** - Import/export Tavern-compatible cards
- ✏️ **Full character editor** - All v2/v3 fields supported (description, scenario, examples, etc.)

### Advanced Chat Features
- 🔄 **Message swipes** - Generate multiple responses and swipe between them
- ✏️ **Message editing** - Edit messages and regenerate from any point
- 🔀 **Chat branching** - Explore alternate conversation paths

### Message Display
- 📝 **Full markdown rendering** - Headers, lists, tables, links, blockquotes
- 🎨 **Syntax highlighting** - Beautiful code blocks with highlight.js
- 📋 **Copy code blocks** - One-click copy button on hover
- ✨ **Smooth animations** - Elegant message transitions

## Running

```bash
npm install
npm run dev
```

Build:
```bash
npm run build
```

**Note**: The dev script includes `WEBKIT_DISABLE_DMABUF_RENDERER=1` to fix Wayland compatibility issues on KDE Plasma.

## Configuration

On first launch, click settings and configure:
- Base URL (e.g., https://api.anthropic.com)
- API Key
- Model (validated from /v1/models endpoint)

- Config stored in `~/.config/claudia/config.json`
- Chat history stored in `~/.config/claudia/history.json`

## Usage

### Keyboard Shortcuts
- **Enter** - Send message
- **Shift+Enter** - New line in message
- **Up Arrow** - Edit last user message
- **Left/Right Arrow** - Swipe between alternative responses

### Character Management
- **Character Dropdown** - Switch between characters
- **Settings → Character Tab** - Edit current character
- **Import v2 Card** - Import Tavern character cards (PNG format)
- **Export v2 Card** - Export character as Tavern-compatible card

### Interface
- **Drag header** - Move window around your desktop
- **Trash icon** - Clear conversation history
- **Settings icon** - Configure API settings
- **Minimize/Maximize** - Window controls

## Roadmap

Claudia is being developed to become a full-featured roleplay platform comparable to SillyTavern. See [ROADMAP.md](ROADMAP.md) for detailed plans including:

**Coming Soon:**
- 📚 World Info/Lorebooks for dynamic context
- 📝 Author's Note for better prompt control
- 👤 User Personas for identity management
- 😊 Character Expression Sprites
- 🔢 Token Counter and context visualization
- 👥 Group Chats with multiple characters
- ⚡ Quick Replies and macro system

**Current Version:** v0.1.0 - Basic character chat with swipes and card import/export
**Next Version:** v0.2.0 - Roleplay Foundation (World Info, Author's Note, Token Counter)

## Contributing

This is a personal project, but feedback and suggestions are welcome! If you encounter bugs or have feature requests, please open an issue on GitHub.
