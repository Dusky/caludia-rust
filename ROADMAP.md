# Claudia Roleplay Enhancement Roadmap

## Current Status

### ✅ Implemented Features
- V2/V3 Character Card Import/Export
- Message Swipes (multiple response alternatives)
- Streaming Responses with toggle
- Character Management (multiple characters)
- Character Avatars with upload and zoom
- Expanded Character Editor (all v2/v3 fields)
- Prompt Presets System (built-in and custom presets with instruction blocks)
- Editable Built-in Presets with Restore to Default
- World Info/Lorebook System (keyword detection, priority, insertion)
- Author's Note (configurable depth and positioning)
- User Personas (identity management with chat/character locking)
- Regex Scripts (global and character-scoped text transformations)
- Chat History Import/Export (JSON format)
- Enhanced Message Controls (delete, pin, hide, continue, regenerate any message)
- Token Counter (real-time display with per-section breakdown)
- Message Examples (character card examples injected into context)
- Chat Branching/Checkpoints (create, switch, delete, rename branches from any message)

### 🎯 Current Focus: Quality of Life & Polish
**Next Up:** Implementing high-impact QoL features to reduce friction and improve user experience - starting with Toast Notifications, Command Palette, Auto-save, Drag & Drop, and Chat Search.

**Recent Completion:** Chat Branching/Checkpoints - Full conversation branching system allowing users to create and explore alternate conversation paths from any message point. Each branch maintains its own complete message history with a branch manager modal for easy navigation.

## Phase 1: Core Roleplay Infrastructure (High Priority)
**Goal: Enable basic roleplay-focused prompt engineering**

### 1. World Info/Lorebook System ✅
- [x] Create UI for managing lorebook entries (keyword, content, priority)
- [x] Implement keyword detection in recent messages
- [x] Add context injection before message generation
- [x] Support recursive entry activation
- [x] Per-character lorebook assignment
- [x] Import/export lorebook files

**Why Important:** World Info is the foundation of consistent roleplay. It allows dynamic context injection based on what's currently relevant in the conversation, saving tokens while maintaining world consistency.

### 2. Author's Note ✅
- [x] Add configurable Author's Note field (inserted at depth 1-5)
- [x] Position control (after system, before/after examples, etc.)
- [x] Per-character Author's Note support
- [x] Template variables in Author's Note

**Why Important:** Author's Note is considered better than system prompts for roleplay because it appears closer to the actual conversation, reducing AI tendency to ignore or forget instructions.

### 3. Jailbreak Templates ✅ (Implemented as Prompt Presets)
- [x] Add jailbreak template field in settings (Prompt Presets with system additions)
- [x] Preset jailbreak templates for roleplay (Built-in presets: Default, Roleplay, Creative Writing, Assistant)
- [x] Per-character jailbreak override option (Active preset per character)
- [x] Template preview and testing (Editable instruction blocks with live preview)

**Why Important:** Many roleplay scenarios require specific prompting to work well with API safety filters and to maintain character consistency.

## Phase 2: Enhanced Character Features (High Priority)
**Goal: Better character representation and user identity**

### 1. User Personas ✅
- [x] Create persona management UI (name, description, avatar)
- [x] Chat-level persona locking
- [x] Character-level persona locking
- [x] Default persona setting
- [x] Quick persona switching

**Why Important:** Allows users to have multiple identities for different roleplay scenarios without manually changing their name and description each time.

### 2. Character Expressions/Sprites
- [ ] Support for emotion-based character images
- [ ] Sentiment analysis of AI responses (local model)
- [ ] 28+ emotion presets (happy, sad, angry, neutral, etc.)
- [ ] Expression sprite packs (import/export)
- [ ] Manual expression override with /emote command
- [ ] Sprite positioning options (beside chat, behind chat, etc.)

**Why Important:** Visual representation of character emotions dramatically enhances immersion and makes conversations feel more alive.

### 3. Message Examples in Context ✅
- [x] Actually use mes_example field from character cards
- [x] Format and inject into prompt properly
- [x] Position control in context
- [x] Token budget allocation for examples

**Why Important:** Message examples help the AI understand the character's voice and writing style, leading to more accurate portrayals.

## Phase 3: Advanced Chat Management (Medium Priority)
**Goal: Non-linear conversation control**

### 1. Chat Branching/Checkpoints ✅
- [x] Save conversation state at any message
- [x] Create branches from any point
- [x] Switch between branches
- [x] Visual branch indicator in UI
- [x] Branch naming and organization
- [x] Delete branches
- [ ] Merge branches (deferred - nice to have)

**Why Important:** Roleplay often involves exploring "what if" scenarios. Branching lets you explore different conversation paths without losing previous progress.

### 2. Enhanced Message Controls ✅
- [x] Delete individual messages (not just clearing all)
- [x] Regenerate any message (not just last)
- [x] Continue incomplete messages
- [x] Message pinning (keep certain messages in context)
- [x] Message folding/hiding
- [ ] Bulk message operations (deferred - nice to have)

**Why Important:** Fine-grained control over conversation history allows users to craft the perfect roleplay session.

### 3. Timeline Visualization
- [ ] Visual tree of chat branches
- [ ] Quick navigation between branches
- [ ] Branch metadata (creation date, message count, etc.)
- [ ] Visual diff between branches
- [ ] Merge branch capability

**Why Important:** Makes managing complex branching conversations intuitive and prevents users from getting lost.

## Phase 4: Multi-Character/Group Chats (Medium Priority)
**Goal: Enable complex multi-character scenarios**

### 1. Group Chat Foundation
- [ ] Create group chat data structure
- [ ] UI for managing group members
- [ ] Add/remove characters from groups
- [ ] Group chat history management
- [ ] Per-group settings

**Why Important:** Many roleplay scenarios involve multiple characters interacting. Group chats enable DM-style gameplay and complex social scenarios.

### 2. Reply Management
- [ ] Manual character selection
- [ ] Natural order (mention-based)
- [ ] Talkativeness settings per character (0-100%)
- [ ] Auto-mode (characters respond automatically)
- [ ] Character muting/unmuting
- [ ] Reply order presets

**Why Important:** Gives users control over conversation flow while allowing for spontaneous multi-character interactions.

### 3. Group Chat UI
- [ ] Character indicators on messages
- [ ] Character list sidebar
- [ ] Mute/unmute controls
- [ ] Character ordering/priority
- [ ] Group-wide lorebook support

**Why Important:** Clear visual indicators make group conversations easy to follow.

## Phase 5: Context & Token Management (Medium Priority)
**Goal: Visibility and control over context usage**

### 1. Token Counter ✅
- [x] Real-time token count display
- [x] Per-section breakdown (system, history, WI, etc.)
- [ ] Visual context budget indicator (deferred)
- [ ] Dotted line showing context cutoff in chat (deferred)
- [ ] Warning when approaching limit (deferred)

**Why Important:** Understanding what's in context and what's being cut is crucial for debugging issues and optimizing prompts. Core functionality complete - visual enhancements can be added later.

### 2. Context Templates
- [ ] Customizable prompt assembly order
- [ ] Handlebars template support
- [ ] Presets for different model types (Alpaca, ChatML, Llama, etc.)
- [ ] Template preview
- [ ] Variable substitution visualization

**Why Important:** Different models expect different prompt formats. Templates ensure prompts are formatted correctly for each model.

### 3. Smart Context Management
- [ ] Summarization of old messages
- [ ] Automatic message trimming
- [ ] Priority-based context allocation
- [ ] Context budget per source (system, WI, history, etc.)
- [ ] Smart message selection (keep important messages)

**Why Important:** Efficient context usage means longer, more coherent conversations without running out of tokens.

## Phase 6: Power User Features (Low Priority)
**Goal: Advanced customization and automation**

### 1. Quick Replies
- [ ] Preset message buttons
- [ ] Macro support in quick replies
- [ ] Import/export QR sets
- [ ] Character-specific QR sets
- [ ] Conditional quick replies
- [ ] Quick reply categories/folders

**Why Important:** Speeds up common actions and reduces repetitive typing in roleplay scenarios.

### 2. Macro System
- [ ] Basic macros ({{user}}, {{char}}, {{random}}, etc.)
- [ ] Date/time macros
- [ ] Conditional macros
- [ ] Custom macro definitions
- [ ] Nested macro support
- [ ] Macro debugging

**Why Important:** Makes prompts and messages dynamic and reusable across different scenarios.

### 3. Regex Scripts ✅
- [x] Global and character-scoped scripts
- [x] Text transformation on messages
- [x] Auto-markdown formatting
- [x] Import/export regex presets
- [x] Regex testing interface
- [x] Script priority/ordering

**Why Important:** Allows automatic text formatting, correction, and enhancement without manual intervention.

### 4. Hotkey System
- [ ] Customizable keyboard shortcuts
- [ ] Quick actions (regen, edit, delete, etc.)
- [ ] Markdown formatting hotkeys
- [ ] Quick Reply hotkeys
- [ ] Navigation hotkeys
- [ ] Hotkey conflict detection

**Why Important:** Power users rely on keyboard shortcuts for efficient workflow.

## Phase 7: Polish & UX (Ongoing)
**Goal: Better user experience for roleplay**

### 1. Instruct Mode Support
- [ ] Preset templates (Alpaca, ChatML, Llama, etc.)
- [ ] Custom template creation
- [ ] Auto-detect model format from API
- [ ] Instruction wrapping for system/user/assistant messages

**Why Important:** Ensures compatibility with instruction-tuned models that expect specific formats.

### 2. Export/Import Improvements
- [ ] Export chats as markdown
- [ ] Export chats as formatted text
- [x] Export chats as JSON with metadata
- [x] Import chats from other formats
- [ ] Bulk character import
- [ ] Character pack support (multiple characters + lorebooks)

**Why Important:** Sharing and migrating content between platforms and backing up work.

### 3. UI Enhancements
- [ ] Message timestamps
- [ ] Character indicators in messages
- [ ] Better settings organization (categories, search)
- [ ] Theme customization (colors, fonts, etc.)
- [ ] Compact/cozy view modes
- [ ] Responsive design for different screen sizes
- [ ] Accessibility improvements

**Why Important:** Better UI means less friction and more immersion in roleplay.

## Phase 8: Quality of Life & Polish (High Priority)
**Goal: Reduce friction, improve feedback, and enhance overall user experience**

### 1. Toast Notification System ✅
- [x] Create toast component (bottom-right positioning)
- [x] Success/error/info/warning variants
- [x] Auto-dismiss with configurable timeout
- [x] Queue multiple toasts
- [x] Hook into all major actions (save, delete, import, export, etc.)

**Why Important:** Users currently have no immediate feedback when actions succeed or fail. Toasts provide instant visual confirmation without blocking workflow.

### 2. Command Palette ✅
- [x] Ctrl+P to open command palette modal
- [x] Fuzzy search for all actions
- [x] Keyboard navigation (arrow keys, enter, escape)
- [x] Recent/frequent actions at top
- [x] Show keyboard shortcuts in results
- [x] Categories (Chat, Character, Settings, etc.)

**Why Important:** Power users want keyboard-first workflow. Command palette dramatically speeds up common actions without memorizing shortcuts.

### 3. Auto-save & Recovery ✅
- [x] Auto-save unsent message in input field
- [x] Restore unsent message after app restart
- [x] Draft system for in-progress edits
- [x] Session recovery (restore scroll position, open panels)
- [x] Crash recovery with last known state

**Why Important:** Losing work due to crashes or accidental closes is extremely frustrating. Auto-save provides a safety net for all user work.

### 4. Drag & Drop Support ✅
- [x] Drag character card PNGs to import
- [x] Drag lorebook JSON files to import
- [x] Drag chat history JSON to import
- [x] Drag images to set as character avatar
- [x] Drop zone overlay with visual feedback
- [x] Support for multiple file drops

**Why Important:** Drag & drop feels natural and is much faster than navigate-click-select workflow. Modern desktop apps are expected to support this.

### 5. Search in Chat History ✅
- [x] Ctrl+F to open search bar
- [x] Highlight all matches in messages
- [x] Navigate between results (prev/next buttons)
- [x] Case-insensitive search
- [x] Search counter (e.g., "3 of 42 matches")
- [x] Clear search and restore view

**Why Important:** Long roleplay sessions can span hundreds of messages. Finding specific content without search is tedious and time-consuming.

### 6. Context Menus (Right-Click) ✅
- [x] Right-click messages for actions (edit, delete, regenerate, branch, copy)
- [x] Right-click character dropdown for quick actions
- [x] Right-click World Info entries for edit/delete
- [x] Right-click in message input for paste/clear/templates
- [x] Context-aware menu items

**Why Important:** Right-click is muscle memory for desktop users. Faster than hovering to reveal action buttons.

### 7. Better Feedback & Confirmations ✅
- [x] Confirmation dialogs for destructive actions (delete character, clear chat)
- [x] Loading spinners for API calls
- [x] Progress bars for file imports
- [x] "Saving..." / "Saved" indicators
- [x] Success messages for completed actions

**Why Important:** Users should never wonder if an action succeeded or is still processing. Clear feedback prevents confusion and repeated clicks.

### 8. Undo/Redo System (Partially Implemented)
- [x] Undo/redo infrastructure (stack management, action types)
- [x] Keyboard shortcuts (Ctrl+Z for undo, Ctrl+Shift+Z for redo)
- [x] Command palette integration
- [ ] Backend support for message delete undo
- [ ] Backend support for message edit undo
- [ ] Undo character field changes
- [ ] Undo World Info changes
- [ ] Action history panel (optional)

**Why Important:** Mistakes happen. An undo system provides a safety net and encourages experimentation without fear of losing work.

**Status:** Frontend infrastructure complete with keyboard shortcuts and command palette entries. Backend support needed for actual undo operations (message restoration functions).

### 9. Settings Search
- [ ] Search bar at top of settings panel
- [ ] Fuzzy search across all setting names and descriptions
- [ ] Highlight matching settings
- [ ] Collapse/expand sections based on matches
- [ ] "Recently changed" section

**Why Important:** With 22+ features, finding specific settings is tedious. Search makes configuration much faster.

### 10. Character Management Enhancements
- [ ] Recent characters quick-switch dropdown
- [ ] Character search/filter by name or tags
- [ ] Character folders/categories
- [ ] Duplicate character (as template)
- [ ] Favorite/star characters
- [ ] Sort options (name, date created, last used)

**Why Important:** Managing 10+ characters becomes messy. Better organization tools scale with user's character collection.

### 11. Enhanced Keyboard Support
- [ ] Full keyboard navigation in all modals (Tab, Arrow keys, Enter)
- [ ] Escape to close any open panel/modal
- [ ] Vim-style navigation mode (optional, j/k for scroll)
- [ ] Keyboard shortcut hints on hover
- [ ] Focus indicators for keyboard navigation

**Why Important:** Keyboard navigation should work everywhere. Current implementation is inconsistent across different UI sections.

### 12. Export/Share Enhancements
- [ ] Export conversation as formatted HTML
- [ ] Export conversation as formatted PDF
- [ ] Export as markdown with proper formatting
- [ ] Copy conversation to clipboard (formatted)
- [ ] Export individual messages

**Why Important:** Users want to share and archive conversations in readable formats, not just JSON.

### 13. Accessibility Improvements
- [ ] ARIA labels for all interactive elements
- [ ] Screen reader support
- [ ] High contrast mode option
- [ ] Larger click targets option (accessibility mode)
- [ ] Reduced motion mode (respect prefers-reduced-motion)
- [ ] Focus indicators for keyboard navigation

**Why Important:** Accessibility makes the app usable for everyone, including users with disabilities. It's also often legally required.

### 14. Better Visual Feedback
- [ ] Smooth transitions for panel open/close
- [ ] Hover states for all interactive elements
- [ ] Active state indicators (focused panel)
- [ ] Better empty states with helpful text
- [ ] Skeleton loaders for content loading
- [ ] Micro-animations for actions (delete, save, etc.)

**Why Important:** Visual polish makes the app feel responsive and professional. Small animations provide context for state changes.

### 15. Smart Defaults & Templates
- [ ] Scenario templates (fantasy RPG, sci-fi, modern, etc.)
- [ ] Pre-filled World Info templates
- [ ] Character card templates
- [ ] Quick-start wizard for new users
- [ ] Import from popular character repositories

**Why Important:** Reduces friction for new users and speeds up common tasks. Templates provide starting points for customization.

## Implementation Priority Ranking

### Must-Have for Basic Roleplay:
1. **World Info/Lorebooks** - Core feature for consistent roleplay
2. **Author's Note** - Better prompt control than system prompts alone
3. **Token Counter** - Visibility into what's happening
4. **Message Examples Usage** - Better character accuracy

### Important for Good Roleplay:
5. **User Personas** - Identity management
6. **Chat Branching** - Non-linear exploration
7. **Enhanced Message Controls** - Fine-grained editing
8. **Jailbreak Templates** - Handle various scenarios

### Great for Enhanced Experience:
9. **Expression Sprites** - Visual immersion
10. **Quick Replies + Macros** - Efficiency
11. **Context Templates** - Model compatibility
12. **Group Chats** - Complex scenarios

### Nice to Have:
13. **Timeline Visualization** - Advanced branch management
14. **Regex Scripts** - Automation
15. **Hotkeys** - Power user efficiency
16. **Smart Context Management** - Optimization

## Research Sources

This roadmap is based on research into SillyTavern's features and best practices from the roleplay AI community:
- SillyTavern official documentation (docs.sillytavern.app)
- Character card specifications (V2/V3 format)
- Community presets and guides on HuggingFace
- Roleplay community feedback and feature requests

## Technical Considerations

### Data Structures Needed:
- Lorebook entries (keyword, content, priority, insertion order, depth)
- Personas (name, description, avatar, chat/character locks)
- Chat branches (branch point, parent branch, metadata)
- Expression mappings (emotion → image file)
- Quick replies (text, macros, conditions, categories)
- Context templates (format strings, variables, presets)

### Backend Changes Required:
- Context assembly refactor (modular system for injecting different sources)
- Token counting integration (model-specific tokenizers)
- Sentiment analysis (local model or API integration)
- Branching chat storage (tree structure instead of linear)
- Group chat message routing (multi-character generation)

### UI Additions Needed:
- Lorebook editor panel
- Persona management panel
- Branch visualization widget
- Token counter display
- Group chat member list
- Quick reply buttons
- Expression sprite overlay
- Context template editor

## Version Milestones

### v0.2.0 - "Roleplay Foundation"
- World Info/Lorebooks
- Author's Note
- Token Counter
- Better Message Controls

### v0.3.0 - "Character Enhancement"
- User Personas
- Expression Sprites
- Message Examples Usage
- Jailbreak Templates

### v0.4.0 - "Advanced Chat"
- Chat Branching
- Timeline Visualization
- Group Chats (basic)

### v0.5.0 - "Power User"
- Quick Replies
- Macros
- Regex Scripts
- Hotkeys

### v1.0.0 - "Feature Complete"
- All planned features implemented
- Polished UI
- Comprehensive documentation
- Import/Export from SillyTavern

## Notes

- Focus on **compatibility with SillyTavern** where possible (character cards, lorebooks, etc.)
- Keep **performance** in mind - roleplay sessions can be long
- Maintain **desktop-first** design - power users prefer desktop interfaces
- Consider **offline-first** approach - local models are popular for roleplay
- Remember **privacy** - roleplay content is often sensitive

---

Last updated: 2025-10-16
