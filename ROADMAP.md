# Claudia Roleplay Enhancement Roadmap

## Current Status

### ✅ Implemented Features
- V2/V3 Character Card Import/Export
- Message Swipes (multiple response alternatives)
- Streaming Responses with toggle
- Character Management (multiple characters)
- Character Avatars with upload and zoom
- Expanded Character Editor (all v2/v3 fields)

### 🎯 Current Focus: UI/UX Improvements
**Decision:** Before adding complex roleplay features, we're focusing on polishing the existing UI/UX to establish a solid foundation. This includes better visual design, improved workflows, and enhanced user experience.

See "Phase 7: Polish & UX" section for details on UI improvements being prioritized.

## Phase 1: Core Roleplay Infrastructure (High Priority)
**Goal: Enable basic roleplay-focused prompt engineering**

### 1. World Info/Lorebook System
- [ ] Create UI for managing lorebook entries (keyword, content, priority)
- [ ] Implement keyword detection in recent messages
- [ ] Add context injection before message generation
- [ ] Support recursive entry activation
- [ ] Per-character lorebook assignment
- [ ] Import/export lorebook files

**Why Important:** World Info is the foundation of consistent roleplay. It allows dynamic context injection based on what's currently relevant in the conversation, saving tokens while maintaining world consistency.

### 2. Author's Note
- [ ] Add configurable Author's Note field (inserted at depth 1-5)
- [ ] Position control (after system, before/after examples, etc.)
- [ ] Per-character Author's Note support
- [ ] Template variables in Author's Note

**Why Important:** Author's Note is considered better than system prompts for roleplay because it appears closer to the actual conversation, reducing AI tendency to ignore or forget instructions.

### 3. Jailbreak Templates
- [ ] Add jailbreak template field in settings
- [ ] Preset jailbreak templates for roleplay
- [ ] Per-character jailbreak override option
- [ ] Template preview and testing

**Why Important:** Many roleplay scenarios require specific prompting to work well with API safety filters and to maintain character consistency.

## Phase 2: Enhanced Character Features (High Priority)
**Goal: Better character representation and user identity**

### 1. User Personas
- [ ] Create persona management UI (name, description, avatar)
- [ ] Chat-level persona locking
- [ ] Character-level persona locking
- [ ] Default persona setting
- [ ] Quick persona switching

**Why Important:** Allows users to have multiple identities for different roleplay scenarios without manually changing their name and description each time.

### 2. Character Expressions/Sprites
- [ ] Support for emotion-based character images
- [ ] Sentiment analysis of AI responses (local model)
- [ ] 28+ emotion presets (happy, sad, angry, neutral, etc.)
- [ ] Expression sprite packs (import/export)
- [ ] Manual expression override with /emote command
- [ ] Sprite positioning options (beside chat, behind chat, etc.)

**Why Important:** Visual representation of character emotions dramatically enhances immersion and makes conversations feel more alive.

### 3. Message Examples in Context
- [ ] Actually use mes_example field from character cards
- [ ] Format and inject into prompt properly
- [ ] Position control in context
- [ ] Token budget allocation for examples

**Why Important:** Message examples help the AI understand the character's voice and writing style, leading to more accurate portrayals.

## Phase 3: Advanced Chat Management (Medium Priority)
**Goal: Non-linear conversation control**

### 1. Chat Branching/Checkpoints
- [ ] Save conversation state at any message
- [ ] Create branches from any point
- [ ] Switch between branches
- [ ] Visual branch indicator in UI
- [ ] Branch naming and organization
- [ ] Delete/merge branches

**Why Important:** Roleplay often involves exploring "what if" scenarios. Branching lets you explore different conversation paths without losing previous progress.

### 2. Enhanced Message Controls
- [ ] Delete individual messages (not just clearing all)
- [ ] Regenerate any message (not just last)
- [ ] Continue incomplete messages
- [ ] Message pinning (keep certain messages in context)
- [ ] Message folding/hiding
- [ ] Bulk message operations

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

### 1. Token Counter
- [ ] Real-time token count display
- [ ] Per-section breakdown (system, history, WI, etc.)
- [ ] Visual context budget indicator
- [ ] Dotted line showing context cutoff in chat
- [ ] Warning when approaching limit

**Why Important:** Understanding what's in context and what's being cut is crucial for debugging issues and optimizing prompts.

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

### 3. Regex Scripts
- [ ] Global and character-scoped scripts
- [ ] Text transformation on messages
- [ ] Auto-markdown formatting
- [ ] Import/export regex presets
- [ ] Regex testing interface
- [ ] Script priority/ordering

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
- [ ] Export chats as JSON with metadata
- [ ] Import chats from other formats
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

Last updated: 2025-10-14
