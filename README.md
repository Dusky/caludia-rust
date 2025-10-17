# Claudia

Desktop AI chat application built with Tauri and Rust, focused on roleplay and character-based interactions.

## Features

### Chat
- Streaming responses with real-time display
- Full markdown rendering with syntax highlighting
- Message swipes (multiple response alternatives)
- Edit and regenerate from any message
- Per-character conversation history
- Copy code blocks with one click

### Characters
- V2/V3 character card import/export (PNG format)
- Multiple characters with avatar support
- Full character editor (description, personality, scenario, examples, etc.)
- Character-specific chat history

### Roleplay Tools
- World Info/Lorebook system with keyword detection and priority
- Author's Note with configurable positioning
- User Personas with chat/character locking
- Prompt Presets with instruction blocks
- Message Examples from character cards
- Regex Scripts for text transformations
- Token counter with per-section breakdown

### API
- Bring-your-own-API (Anthropic-compatible)
- Automatic model detection via /v1/models
- API validation and error handling

## Running

```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
```

## Configuration

On first launch, configure in Settings:
- Base URL (e.g., https://api.anthropic.com)
- API Key
- Model

Config stored in `~/.config/claudia/config.json`

## Keyboard Shortcuts

- **Enter** - Send message
- **Shift+Enter** - New line
- **Ctrl+Enter** - Send message (alternative)
- **Up Arrow** - Edit last user message (when input is at start)
- **Left/Right Arrow** - Navigate between response alternatives
- **Escape** - Close panels/modals, cancel editing
- **Ctrl+K** - Focus message input
- **Ctrl+P** - Open command palette (quick access to all actions)
- **Ctrl+F** - Search in chat history
- **Ctrl+/** - Toggle Roleplay Tools panel

## Roadmap

See [ROADMAP.md](ROADMAP.md) for detailed development plans.

**Current Focus:** Chat Branching/Checkpoints for non-linear conversation exploration

**Upcoming:**
- Chat branching with timeline visualization
- Character expression sprites
- Group chats with multiple characters
- Quick replies and macro system
- Context templates for different model formats

## Development

Built with:
- Tauri 2.0
- Rust backend
- Vanilla JavaScript frontend
- tiktoken-rs for token counting
