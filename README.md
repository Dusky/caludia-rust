# Claudia

Beautiful AI desktop companion built with Tauri and Rust.

## Features

### Core Features
- 🎨 **Beautiful glassmorphic UI** with gradient backgrounds and blur effects
- 🔧 **Bring-your-own-API** - supports any Anthropic-compatible API
- ✅ **API validation** via /v1/models endpoint
- 💬 **Full conversation context** - AI remembers your entire conversation
- 💾 **Persistent chat history** - conversations saved between sessions
- 🎯 **Custom window controls** - drag, minimize, maximize, close

### Message Display
- 📝 **Full markdown rendering** - headers, lists, tables, links, blockquotes
- 🎨 **Syntax highlighting** - beautiful code blocks with highlight.js
- 📋 **Copy code blocks** - one-click copy button on hover
- ✨ **Smooth animations** - elegant message transitions

### User Experience
- ⌨️ **Keyboard shortcuts** - Enter or Ctrl+Enter to send, Shift+Enter for new lines
- 🗑️ **Clear conversations** - easily start fresh
- 🎯 **Auto-resizing input** - textarea grows with your message
- 🎭 **Light/dark mode** - automatic based on system preferences

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

### Interface
- **Drag header** - Move window around your desktop
- **Trash icon** - Clear conversation history
- **Settings icon** - Configure API settings
- **Minimize/Maximize** - Window controls
