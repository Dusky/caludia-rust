const { invoke } = window.__TAURI__.core;

// Track app start time for loading overlay
window.appStartTime = Date.now();

// ============================================================================
// Plugin System - ClaudiaPluginAPI
// ============================================================================

// Hook registry for plugins
const pluginHooks = {
  beforeMessageSend: [],
  afterMessageReceive: [],
  onMessageDisplay: [],
  registerAIBackend: [],
  registerExportFormat: [],
  modifyContext: [],
  addUIComponent: []
};

// Plugin settings UI registry
const pluginSettingsRegistry = {};

// Global Plugin API exposed to plugins
window.ClaudiaPluginAPI = {
  // Hook registration
  registerHook(hookName, callback) {
    if (!pluginHooks[hookName]) {
      console.error(`Unknown hook: ${hookName}`);
      return false;
    }
    pluginHooks[hookName].push(callback);
    console.log(`Plugin registered hook: ${hookName}`);
    return true;
  },

  // Register plugin settings UI
  registerSettingsUI(pluginId, settingsCallback) {
    console.log(`registerSettingsUI called for ${pluginId}`, typeof settingsCallback);
    if (typeof settingsCallback !== 'function') {
      console.error(`Settings callback for ${pluginId} must be a function`);
      return false;
    }
    pluginSettingsRegistry[pluginId] = settingsCallback;
    console.log(`Plugin ${pluginId} registered settings UI successfully`);
    console.log('Current registry:', pluginSettingsRegistry);
    return true;
  },

  // Invoke Tauri backend commands
  async invoke(command, params) {
    return await invoke(command, params);
  },

  // Plugin configuration storage
  async getConfig(pluginId, key) {
    const config = localStorage.getItem(`plugin_${pluginId}_${key}`);
    return config ? JSON.parse(config) : null;
  },

  setConfig(pluginId, key, value) {
    localStorage.setItem(`plugin_${pluginId}_${key}`, JSON.stringify(value));
  },

  // Plugin logging
  log(pluginId, message) {
    console.log(`[Plugin: ${pluginId}]`, message);
  },

  error(pluginId, message) {
    console.error(`[Plugin: ${pluginId}]`, message);
  },

  // Get current app state
  getCurrentCharacter() {
    return currentCharacter;
  },

  getChatHistory() {
    return invoke('get_chat_history');
  }
};

// Execute plugin hooks
async function executeHook(hookName, data) {
  const hooks = pluginHooks[hookName] || [];
  let result = data;

  for (const hook of hooks) {
    try {
      result = await hook(result);
    } catch (error) {
      console.error(`Error in plugin hook ${hookName}:`, error);
    }
  }

  return result;
}

let messageInput;
let messagesContainer;
let chatForm;
let sendBtn;
let statusText;
let settingsPanel;
let chatView;
let characterSelect;
let characterHeaderName;
let newCharacterBtn;

let currentCharacter = null;
let pendingAvatarPath = null;

// Cached config values
let cachedContextLimit = 200000; // Default value

// Undo/Redo System
let undoStack = [];
let redoStack = [];
const MAX_UNDO_STACK_SIZE = 50; // Limit stack size to prevent memory issues

// Action types for undo/redo
const UndoActionType = {
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  MESSAGE_EDIT: 'MESSAGE_EDIT',
  CHARACTER_FIELD: 'CHARACTER_FIELD',
  WORLD_INFO: 'WORLD_INFO'
};

// Record an action for undo
function recordUndoAction(action) {
  undoStack.push(action);

  // Limit stack size
  if (undoStack.length > MAX_UNDO_STACK_SIZE) {
    undoStack.shift(); // Remove oldest action
  }

  // Clear redo stack when new action is recorded
  redoStack = [];

  updateUndoRedoUI();
}

// Perform undo
async function performUndo() {
  if (undoStack.length === 0) {
    showInfo('Nothing to Undo', 'No actions available to undo.');
    return;
  }

  const action = undoStack.pop();

  try {
    switch (action.type) {
      case UndoActionType.MESSAGE_DELETE:
        await undoMessageDelete(action);
        break;
      case UndoActionType.MESSAGE_EDIT:
        await undoMessageEdit(action);
        break;
      case UndoActionType.CHARACTER_FIELD:
        await undoCharacterField(action);
        break;
      case UndoActionType.WORLD_INFO:
        await undoWorldInfo(action);
        break;
      default:
        console.error('Unknown undo action type:', action.type);
        return;
    }

    // Add to redo stack
    redoStack.push(action);
    updateUndoRedoUI();
    showSuccess('Undo Complete', action.description || 'Action undone successfully.');
  } catch (error) {
    console.error('Undo failed:', error);
    showError('Undo Failed', `Failed to undo action: ${error}`);
    // Put action back on undo stack if it failed
    undoStack.push(action);
  }
}

// Perform redo
async function performRedo() {
  if (redoStack.length === 0) {
    showInfo('Nothing to Redo', 'No actions available to redo.');
    return;
  }

  const action = redoStack.pop();

  try {
    switch (action.type) {
      case UndoActionType.MESSAGE_DELETE:
        await redoMessageDelete(action);
        break;
      case UndoActionType.MESSAGE_EDIT:
        await redoMessageEdit(action);
        break;
      case UndoActionType.CHARACTER_FIELD:
        await redoCharacterField(action);
        break;
      case UndoActionType.WORLD_INFO:
        await redoWorldInfo(action);
        break;
      default:
        console.error('Unknown redo action type:', action.type);
        return;
    }

    // Add back to undo stack
    undoStack.push(action);
    updateUndoRedoUI();
    showSuccess('Redo Complete', action.description || 'Action redone successfully.');
  } catch (error) {
    console.error('Redo failed:', error);
    showError('Redo Failed', `Failed to redo action: ${error}`);
    // Put action back on redo stack if it failed
    redoStack.push(action);
  }
}

// Update UI to reflect undo/redo availability
function updateUndoRedoUI() {
  // This can be used to enable/disable undo/redo buttons if we add them
  // For now, just used to track state
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  // Update command palette if it exists
  if (window.updateCommandPaletteState) {
    window.updateCommandPaletteState({ canUndo, canRedo });
  }
}

// Undo action implementations
async function undoMessageDelete(action) {
  // Insert message back at the original index
  await invoke('insert_message_at_index', {
    messageIndex: action.messageIndex,
    message: action.messageData
  });

  // Reload chat history to reflect the change
  await loadChatHistory();
  await updateTokenCount();
}

async function redoMessageDelete(action) {
  // Re-delete the message at the index
  await invoke('delete_message_at_index', { messageIndex: action.messageIndex });

  // Reload chat history to reflect the change
  await loadChatHistory();
  await updateTokenCount();
}

async function undoMessageEdit(action) {
  // Restore the original messages from the edit point
  await invoke('replace_messages_from_index', {
    startIndex: action.messageIndex,
    messages: action.originalMessages
  });

  // Reload chat history to reflect the change
  await loadChatHistory();
  await updateTokenCount();
}

async function redoMessageEdit(action) {
  // Truncate from the edit point and resend the edited message
  await invoke('truncate_history_from', { index: action.messageIndex });
  await loadChatHistory();
  await sendMessage(action.newContent);
  await updateTokenCount();
}

async function undoCharacterField(action) {
  // Restore character field to previous value
  const fieldElement = document.getElementById(action.fieldId);
  if (fieldElement) {
    fieldElement.value = action.oldValue;

    // Trigger auto-save
    currentCharacter[action.fieldName] = action.oldValue;
    await autoSaveCharacter();
  }
}

async function redoCharacterField(action) {
  // Re-apply field change
  const fieldElement = document.getElementById(action.fieldId);
  if (fieldElement) {
    fieldElement.value = action.newValue;

    // Trigger auto-save
    currentCharacter[action.fieldName] = action.newValue;
    await autoSaveCharacter();
  }
}

async function undoWorldInfo(action) {
  // Restore World Info entry to previous state
  // This would require backend support for world info history
  await invoke('restore_world_info_entry', {
    entryId: action.entryId,
    previousState: action.previousState
  });

  // Reload world info panel
  if (window.reloadWorldInfoPanel) {
    await window.reloadWorldInfoPanel();
  }
}

async function redoWorldInfo(action) {
  // Re-apply World Info change
  await invoke('restore_world_info_entry', {
    entryId: action.entryId,
    previousState: action.newState
  });

  // Reload world info panel
  if (window.reloadWorldInfoPanel) {
    await window.reloadWorldInfoPanel();
  }
}

// Theme definitions
const themes = {
  dark: {
    name: 'Dark (Default)',
    bgPrimary: '#1a1a1a',
    bgSecondary: '#252525',
    bgTertiary: '#2f2f2f',
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    userMsg: '#4f46e5',
    assistantMsg: '#2f2f2f',
    border: '#3a3a3a',
    gradient: 'linear-gradient(135deg, #1a1a1a 0%, #2a1a2a 100%)',
    glow: 'rgba(99, 102, 241, 0.1)'
  },
  darker: {
    name: 'Darker',
    bgPrimary: '#0a0a0a',
    bgSecondary: '#141414',
    bgTertiary: '#1a1a1a',
    textPrimary: '#e0e0e0',
    textSecondary: '#909090',
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    userMsg: '#6d28d9',
    assistantMsg: '#1a1a1a',
    border: '#2a2a2a',
    gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a0a1a 100%)',
    glow: 'rgba(124, 58, 237, 0.1)'
  },
  midnight: {
    name: 'Midnight Blue',
    bgPrimary: '#0f1419',
    bgSecondary: '#1a2332',
    bgTertiary: '#243447',
    textPrimary: '#e6f1ff',
    textSecondary: '#8892a0',
    accent: '#3b82f6',
    accentHover: '#2563eb',
    userMsg: '#1e40af',
    assistantMsg: '#243447',
    border: '#2d3e54',
    gradient: 'linear-gradient(135deg, #0f1419 0%, #1a2845 100%)',
    glow: 'rgba(59, 130, 246, 0.1)'
  },
  forest: {
    name: 'Forest',
    bgPrimary: '#0d1b14',
    bgSecondary: '#162820',
    bgTertiary: '#1f352b',
    textPrimary: '#e8f5e9',
    textSecondary: '#90a89f',
    accent: '#10b981',
    accentHover: '#059669',
    userMsg: '#047857',
    assistantMsg: '#1f352b',
    border: '#2d4a3a',
    gradient: 'linear-gradient(135deg, #0d1b14 0%, #1a2820 100%)',
    glow: 'rgba(16, 185, 129, 0.1)'
  },
  sunset: {
    name: 'Sunset',
    bgPrimary: '#1a1214',
    bgSecondary: '#261a1e',
    bgTertiary: '#332228',
    textPrimary: '#fde8e8',
    textSecondary: '#b89090',
    accent: '#f97316',
    accentHover: '#ea580c',
    userMsg: '#c2410c',
    assistantMsg: '#332228',
    border: '#4a3238',
    gradient: 'linear-gradient(135deg, #1a1214 0%, #2a1a1e 100%)',
    glow: 'rgba(249, 115, 22, 0.1)'
  },
  light: {
    name: 'Light',
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f5',
    bgTertiary: '#e8e8e8',
    textPrimary: '#1a1a1a',
    textSecondary: '#666666',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    userMsg: '#6366f1',
    assistantMsg: '#f0f0f0',
    border: '#d0d0d0',
    gradient: 'linear-gradient(135deg, #ffffff 0%, #f5f0ff 100%)',
    glow: 'rgba(99, 102, 241, 0.05)'
  }
};

// Apply theme
function applyTheme(themeName) {
  const theme = themes[themeName];
  if (!theme) return;

  const root = document.documentElement;
  root.style.setProperty('--bg-primary', theme.bgPrimary);
  root.style.setProperty('--bg-secondary', theme.bgSecondary);
  root.style.setProperty('--bg-tertiary', theme.bgTertiary);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-hover', theme.accentHover);
  root.style.setProperty('--user-msg', theme.userMsg);
  root.style.setProperty('--assistant-msg', theme.assistantMsg);
  root.style.setProperty('--border', theme.border);

  // Update gradient and glow
  const appContainer = document.querySelector('.app-container');
  if (appContainer) {
    appContainer.style.background = theme.gradient;
    const glow = appContainer.querySelector('::before');
  }

  // Store preference
  localStorage.setItem('claudia-theme', themeName);
}

// Load saved theme
function loadSavedTheme() {
  const savedTheme = localStorage.getItem('claudia-theme') || 'dark';
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = savedTheme;
  }
  applyTheme(savedTheme);
}

// Toast Notification System
const toastQueue = [];
let toastContainer;

function showToast(options) {
  const {
    type = 'info',
    title,
    message,
    duration = 3000,
    dismissible = true
  } = options;

  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Icon based on type
  const icons = {
    success: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M16.667 5L7.5 14.167L3.333 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="2"/>
      <path d="M10 6v4M10 13h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 3.333L17.5 16.667H2.5L10 3.333z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 8.333v3.334M10 14.167h.008" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    info: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="2"/>
      <path d="M10 13.333V10M10 6.667h.008" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ''}
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    ${dismissible ? `<button class="toast-close" aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>` : ''}
    ${duration > 0 ? `<div class="toast-progress"><div class="toast-progress-bar" style="--duration: ${duration}ms;"></div></div>` : ''}
  `;

  toastContainer.appendChild(toast);

  // Dismiss on close button click
  if (dismissible) {
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
      dismissToast(toast);
    });
  }

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(toast);
    }, duration);
  }

  // Click to dismiss (anywhere on toast)
  toast.addEventListener('click', (e) => {
    if (e.target !== toast.querySelector('.toast-close') && e.target.closest('.toast-close') === null) {
      dismissToast(toast);
    }
  });

  return toast;
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;

  toast.classList.add('removing');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// Convenience functions
function showSuccess(title, message, duration) {
  return showToast({ type: 'success', title, message, duration });
}

function showError(title, message, duration) {
  return showToast({ type: 'error', title, message, duration });
}

function showWarning(title, message, duration) {
  return showToast({ type: 'warning', title, message, duration });
}

function showInfo(title, message, duration) {
  return showToast({ type: 'info', title, message, duration });
}

// Command Palette System
let commandPaletteModal;
let commandPaletteInput;
let commandPaletteResults;
let selectedCommandIndex = 0;
let filteredCommands = [];

// Define all available commands
const commands = [
  // Chat actions
  {
    id: 'clear-chat',
    title: 'Clear Conversation',
    description: 'Clear all messages in the current conversation',
    category: 'Chat',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14M6 4V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1M5 4v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => clearHistory(),
    keywords: ['delete', 'remove', 'reset']
  },
  {
    id: 'export-chat',
    title: 'Export Conversation',
    description: 'Save conversation to a JSON file',
    category: 'Chat',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M7 10l3 3 3-3" stroke="currentColor" stroke-width="1.5"/><path d="M3 16h14" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => exportChatHistory(),
    keywords: ['save', 'download', 'backup']
  },
  {
    id: 'import-chat',
    title: 'Import Conversation',
    description: 'Load conversation from a JSON file',
    category: 'Chat',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13V3M7 6l3-3 3 3" stroke="currentColor" stroke-width="1.5"/><path d="M3 16h14" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => importChatHistory(),
    keywords: ['load', 'restore', 'open']
  },
  {
    id: 'undo',
    title: 'Undo',
    description: 'Undo last action (message delete, edit)',
    category: 'Chat',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 8h9a3 3 0 0 1 0 6H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 5l-3 3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    action: () => performUndo(),
    shortcut: ['Ctrl', 'Z'],
    keywords: ['revert', 'back', 'reverse']
  },
  {
    id: 'redo',
    title: 'Redo',
    description: 'Redo previously undone action',
    category: 'Chat',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M16 8H7a3 3 0 0 0 0 6h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    action: () => performRedo(),
    shortcut: ['Ctrl', 'Shift', 'Z'],
    keywords: ['forward', 'repeat']
  },
  // Character actions
  {
    id: 'new-character',
    title: 'New Character',
    description: 'Create a new character',
    category: 'Characters',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => handleNewCharacter(),
    shortcut: ['Ctrl', 'N'],
    keywords: ['create', 'add']
  },
  {
    id: 'import-character',
    title: 'Import Character Card',
    description: 'Import a character from PNG card',
    category: 'Characters',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13V3M7 6l3-3 3 3" stroke="currentColor" stroke-width="1.5"/><path d="M3 16h14" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => handleImportCharacter(),
    keywords: ['load', 'v2', 'card', 'png']
  },
  {
    id: 'export-character',
    title: 'Export Character Card',
    description: 'Export current character as PNG card',
    category: 'Characters',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M7 10l3 3 3-3" stroke="currentColor" stroke-width="1.5"/><path d="M3 16h14" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => handleExportCharacter(),
    keywords: ['save', 'v2', 'card', 'png']
  },
  {
    id: 'delete-character',
    title: 'Delete Character',
    description: 'Delete the current character',
    category: 'Characters',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14M6 4V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1M5 4v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => handleDeleteCharacter(),
    keywords: ['remove']
  },
  // Settings actions
  {
    id: 'open-settings',
    title: 'Open Settings',
    description: 'Open the settings panel',
    category: 'Settings',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M17 10c0-.5-.1-1-.3-1.4l1.2-.7-1-1.7-1.2.7c-.6-.6-1.3-1-2.1-1.2V4h-2v1.7c-.8.2-1.5.6-2.1 1.2L8.3 6.2l-1 1.7 1.2.7C8.1 9 8 9.5 8 10s.1 1 .3 1.4l-1.2.7 1 1.7 1.2-.7c.6.6 1.3 1 2.1 1.2V16h2v-1.7c.8-.2 1.5-.6 2.1-1.2l1.2.7 1-1.7-1.2-.7c.2-.4.3-.9.3-1.4z" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => showSettings(),
    keywords: ['preferences', 'config', 'api']
  },
  {
    id: 'open-roleplay-tools',
    title: 'Open Roleplay Tools',
    description: 'Open the roleplay tools panel',
    category: 'Settings',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => showRoleplayPanel(),
    shortcut: ['Ctrl', '/'],
    keywords: ['world info', 'lorebook', 'persona', 'preset']
  },
  // Focus actions
  {
    id: 'focus-input',
    title: 'Focus Message Input',
    description: 'Move cursor to the message input',
    category: 'Navigation',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M13 6l4 4-4 4" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => {
      if (messageInput) messageInput.focus();
      closeCommandPalette();
    },
    shortcut: ['Ctrl', 'K'],
    keywords: ['cursor', 'type']
  },
  // Theme actions
  {
    id: 'theme-dark',
    title: 'Switch to Dark Theme',
    description: 'Change theme to dark mode',
    category: 'Appearance',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17 10.5A7 7 0 1 1 9.5 3a6 6 0 0 0 7.5 7.5z" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => {
      applyTheme('dark');
      document.getElementById('theme-select').value = 'dark';
      closeCommandPalette();
      showSuccess('Theme Changed', 'Switched to Dark theme');
    },
    keywords: ['color', 'style']
  },
  {
    id: 'theme-light',
    title: 'Switch to Light Theme',
    description: 'Change theme to light mode',
    category: 'Appearance',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.66 4.34l-1.41 1.41M5.75 14.25l-1.41 1.41M15.66 15.66l-1.41-1.41M5.75 5.75L4.34 4.34" stroke="currentColor" stroke-width="1.5"/></svg>`,
    action: () => {
      applyTheme('light');
      document.getElementById('theme-select').value = 'light';
      closeCommandPalette();
      showSuccess('Theme Changed', 'Switched to Light theme');
    },
    keywords: ['color', 'style']
  }
];

function openCommandPalette() {
  if (!commandPaletteModal) {
    commandPaletteModal = document.getElementById('command-palette-modal');
    commandPaletteInput = document.getElementById('command-palette-input');
    commandPaletteResults = document.getElementById('command-palette-results');

    // Overlay click to close
    commandPaletteModal.querySelector('.command-palette-overlay').addEventListener('click', closeCommandPalette);

    // Input event listener for filtering
    commandPaletteInput.addEventListener('input', (e) => {
      filterCommands(e.target.value);
    });
  }

  commandPaletteModal.style.display = 'flex';
  commandPaletteInput.value = '';
  selectedCommandIndex = 0;

  // Show all commands initially
  filterCommands('');

  // Focus the input after a brief delay to ensure modal is visible
  setTimeout(() => {
    commandPaletteInput.focus();
  }, 50);
}

function closeCommandPalette() {
  if (commandPaletteModal) {
    commandPaletteModal.style.display = 'none';
    commandPaletteInput.value = '';
  }
}

function filterCommands(searchTerm) {
  const term = searchTerm.toLowerCase().trim();

  if (term === '') {
    filteredCommands = [...commands];
  } else {
    filteredCommands = commands.filter(cmd => {
      const titleMatch = cmd.title.toLowerCase().includes(term);
      const descMatch = cmd.description.toLowerCase().includes(term);
      const categoryMatch = cmd.category.toLowerCase().includes(term);
      const keywordMatch = cmd.keywords && cmd.keywords.some(k => k.includes(term));

      return titleMatch || descMatch || categoryMatch || keywordMatch;
    });
  }

  selectedCommandIndex = 0;
  renderCommandResults();
}

function renderCommandResults() {
  if (filteredCommands.length === 0) {
    commandPaletteResults.innerHTML = `
      <div class="command-palette-empty">
        <svg class="command-palette-empty-icon" viewBox="0 0 48 48" fill="none">
          <circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="3"/>
          <path d="M32 32l10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          <path d="M20 14v12M20 30h.02" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <p class="command-palette-empty-text">No commands found</p>
      </div>
    `;
    return;
  }

  // Group commands by category
  const grouped = {};
  filteredCommands.forEach(cmd => {
    if (!grouped[cmd.category]) {
      grouped[cmd.category] = [];
    }
    grouped[cmd.category].push(cmd);
  });

  let html = '';
  Object.keys(grouped).forEach((category, catIndex) => {
    html += `<div class="command-palette-section">${category}</div>`;

    grouped[category].forEach((cmd, cmdIndex) => {
      const globalIndex = filteredCommands.indexOf(cmd);
      const isSelected = globalIndex === selectedCommandIndex;

      html += `
        <div class="command-item ${isSelected ? 'selected' : ''}" data-index="${globalIndex}">
          <div class="command-item-icon">${cmd.icon}</div>
          <div class="command-item-content">
            <div class="command-item-title">${cmd.title}</div>
            <div class="command-item-description">${cmd.description}</div>
          </div>
          ${cmd.shortcut ? `
            <div class="command-item-shortcut">
              ${cmd.shortcut.map(key => `<kbd>${key}</kbd>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    });
  });

  commandPaletteResults.innerHTML = html;

  // Add click handlers
  commandPaletteResults.querySelectorAll('.command-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      executeCommand(filteredCommands[index]);
    });
  });

  // Scroll selected item into view
  const selectedItem = commandPaletteResults.querySelector('.command-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function executeCommand(command) {
  if (command && command.action) {
    closeCommandPalette();
    command.action();
  }
}

function handleCommandPaletteKeydown(e) {
  if (!commandPaletteModal || commandPaletteModal.style.display === 'none') return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedCommandIndex = Math.min(selectedCommandIndex + 1, filteredCommands.length - 1);
    renderCommandResults();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedCommandIndex = Math.max(selectedCommandIndex - 1, 0);
    renderCommandResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      executeCommand(filteredCommands[selectedCommandIndex]);
    }
  }
}

// Auto-save & Recovery System
let autoSaveTimeout;
const AUTO_SAVE_DELAY = 1000; // Save after 1 second of inactivity

function getAutoSaveKey() {
  if (!currentCharacter) return null;
  return `claudia-draft-${currentCharacter.id}`;
}

function autoSaveMessageInput() {
  const key = getAutoSaveKey();
  if (!key || !messageInput) return;

  const content = messageInput.value.trim();

  if (content === '') {
    // Clear the draft if input is empty
    localStorage.removeItem(key);
  } else {
    // Save the draft
    const draft = {
      content,
      timestamp: Date.now(),
      characterId: currentCharacter.id,
      characterName: currentCharacter.name
    };
    localStorage.setItem(key, JSON.stringify(draft));
  }
}

function loadAutoSavedDraft() {
  const key = getAutoSaveKey();
  if (!key || !messageInput) return;

  try {
    const savedDraft = localStorage.getItem(key);
    if (!savedDraft) return;

    const draft = JSON.parse(savedDraft);

    // Check if draft is not too old (older than 7 days)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const age = Date.now() - draft.timestamp;

    if (age > maxAge) {
      // Draft is too old, remove it
      localStorage.removeItem(key);
      return;
    }

    // Restore the draft
    if (draft.content && draft.content.trim() !== '') {
      messageInput.value = draft.content;

      // Auto-resize the textarea
      messageInput.style.height = 'auto';
      messageInput.style.height = messageInput.scrollHeight + 'px';

      // Show notification
      const draftAge = formatDraftAge(age);
      showInfo('Draft Recovered', `Unsent message from ${draftAge} ago has been restored.`, 4000);
    }
  } catch (error) {
    console.error('Failed to load auto-saved draft:', error);
  }
}

function clearAutoSavedDraft() {
  const key = getAutoSaveKey();
  if (!key) return;
  localStorage.removeItem(key);
}

function formatDraftAge(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return 'a few seconds';
}

function setupAutoSave() {
  if (!messageInput) return;

  // Auto-save on input with debouncing
  messageInput.addEventListener('input', () => {
    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Set new timeout to save after delay
    autoSaveTimeout = setTimeout(() => {
      autoSaveMessageInput();
    }, AUTO_SAVE_DELAY);
  });

  // Also save on blur (when user clicks away)
  messageInput.addEventListener('blur', () => {
    autoSaveMessageInput();
  });
}

// Drag and Drop System
let dragDropOverlay;
let dragCounter = 0; // Track nested drag events

function setupDragAndDrop() {
  dragDropOverlay = document.getElementById('drag-drop-overlay');

  // Prevent default drag behaviors on the entire document
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // Show overlay when dragging file into window
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter++;

    // Only show overlay if dragging files
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      document.body.classList.add('drag-over');
      if (dragDropOverlay) {
        dragDropOverlay.classList.add('active');
      }
    }
  });

  // Hide overlay when dragging leaves window
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter--;

    // Only hide when completely leaving the window
    if (dragCounter === 0) {
      document.body.classList.remove('drag-over');
      if (dragDropOverlay) {
        dragDropOverlay.classList.remove('active');
      }
    }
  });

  // Handle file drop
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset drag state
    dragCounter = 0;
    document.body.classList.remove('drag-over');
    if (dragDropOverlay) {
      dragDropOverlay.classList.remove('active');
    }

    // Get dropped files
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0]; // Only handle first file
    const fileName = file.name.toLowerCase();

    // Detect file type and show appropriate message
    if (fileName.endsWith('.png')) {
      showInfo(
        'Character Card Import',
        'To import character cards, please use the "Import Character Card" button in Settings > Character tab.',
        5000
      );
    } else if (fileName.endsWith('.json')) {
      showInfo(
        'Chat History Import',
        'To import chat history, please use the "Import" button at the top of the chat.',
        5000
      );
    } else {
      showWarning(
        'Unsupported File Type',
        'Please drop a PNG character card or JSON chat history file.',
        4000
      );
    }
  });
}

// Chat Search System
let chatSearchBar;
let chatSearchInput;
let chatSearchCurrent;
let chatSearchTotal;
let chatSearchPrevBtn;
let chatSearchNextBtn;
let chatSearchCloseBtn;
let searchMatches = [];
let currentMatchIndex = -1;

function setupChatSearch() {
  chatSearchBar = document.getElementById('chat-search-bar');
  chatSearchInput = document.getElementById('chat-search-input');
  chatSearchCurrent = document.getElementById('chat-search-current');
  chatSearchTotal = document.getElementById('chat-search-total');
  chatSearchPrevBtn = document.getElementById('chat-search-prev');
  chatSearchNextBtn = document.getElementById('chat-search-next');
  chatSearchCloseBtn = document.getElementById('chat-search-close');

  // Search input listener
  chatSearchInput.addEventListener('input', () => {
    performSearch(chatSearchInput.value);
  });

  // Navigation buttons
  chatSearchPrevBtn.addEventListener('click', () => {
    navigateToMatch('prev');
  });

  chatSearchNextBtn.addEventListener('click', () => {
    navigateToMatch('next');
  });

  // Close button
  chatSearchCloseBtn.addEventListener('click', () => {
    closeChatSearch();
  });

  // Enter key to navigate forward
  chatSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateToMatch(e.shiftKey ? 'prev' : 'next');
    }
  });
}

function openChatSearch() {
  if (chatSearchBar) {
    chatSearchBar.style.display = 'block';
    chatSearchInput.focus();
    chatSearchInput.select();
  }
}

function closeChatSearch() {
  if (chatSearchBar) {
    chatSearchBar.style.display = 'none';
    chatSearchInput.value = '';
    clearSearchHighlights();
    searchMatches = [];
    currentMatchIndex = -1;
    updateSearchCounter();
  }
}

// Settings Search
function setupSettingsSearch() {
  const settingsSearchInput = document.getElementById('settings-search-input');
  const settingsSearchClearBtn = document.getElementById('settings-search-clear');

  if (!settingsSearchInput || !settingsSearchClearBtn) return;

  // Search input listener
  settingsSearchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value;
    performSettingsSearch(searchTerm);

    // Show/hide clear button
    settingsSearchClearBtn.style.display = searchTerm ? 'flex' : 'none';
  });

  // Clear button listener
  settingsSearchClearBtn.addEventListener('click', () => {
    settingsSearchInput.value = '';
    performSettingsSearch('');
    settingsSearchClearBtn.style.display = 'none';
    settingsSearchInput.focus();
  });
}

function performSettingsSearch(searchTerm) {
  const settingsPanel = document.getElementById('settings-panel');
  if (!settingsPanel) return;

  // Get all settings sections and form groups
  const sections = settingsPanel.querySelectorAll('.settings-section');
  const formGroups = settingsPanel.querySelectorAll('.form-group');
  const tabs = settingsPanel.querySelectorAll('.tab-content');

  // If search is empty, show everything
  if (!searchTerm || searchTerm.trim() === '') {
    sections.forEach(section => section.classList.remove('search-hidden'));
    formGroups.forEach(group => group.classList.remove('search-hidden'));
    clearSettingsHighlights();
    return;
  }

  const term = searchTerm.toLowerCase();

  // Search in all tabs
  tabs.forEach(tab => {
    let tabHasMatch = false;

    // Search in collapsible sections within this tab
    const tabSections = tab.querySelectorAll('.settings-section');
    tabSections.forEach(section => {
      const sectionContent = section.querySelector('.settings-section-content');
      const sectionTitle = section.querySelector('.settings-section-title');
      const sectionGroups = sectionContent ? sectionContent.querySelectorAll('.form-group') : [];

      let sectionHasMatch = false;

      // Check if section title matches
      if (sectionTitle && sectionTitle.textContent.toLowerCase().includes(term)) {
        sectionHasMatch = true;
      }

      // Check each form group in this section
      sectionGroups.forEach(group => {
        const label = group.querySelector('label');
        const input = group.querySelector('input, select, textarea');
        const text = group.textContent.toLowerCase();
        const placeholder = input ? (input.placeholder || '').toLowerCase() : '';

        if (text.includes(term) || placeholder.includes(term)) {
          group.classList.remove('search-hidden');
          sectionHasMatch = true;
          highlightSettingsMatch(group, term);
        } else {
          group.classList.add('search-hidden');
        }
      });

      // Show/hide section based on matches
      if (sectionHasMatch) {
        section.classList.remove('search-hidden');
        // Auto-expand collapsed sections with matches
        section.classList.remove('collapsed');
        tabHasMatch = true;
      } else {
        section.classList.add('search-hidden');
      }
    });

    // Search in direct form groups (not in sections)
    const directFormGroups = Array.from(tab.querySelectorAll('.form-group')).filter(group => {
      return !group.closest('.settings-section-content');
    });

    directFormGroups.forEach(group => {
      const text = group.textContent.toLowerCase();
      const input = group.querySelector('input, select, textarea');
      const placeholder = input ? (input.placeholder || '').toLowerCase() : '';

      if (text.includes(term) || placeholder.includes(term)) {
        group.classList.remove('search-hidden');
        highlightSettingsMatch(group, term);
        tabHasMatch = true;
      } else {
        group.classList.add('search-hidden');
      }
    });
  });
}

function highlightSettingsMatch(element, term) {
  clearSettingsHighlights(element);

  // Highlight in labels
  const labels = element.querySelectorAll('label');
  labels.forEach(label => {
    const text = label.textContent;
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(term);

    if (index !== -1 && !label.querySelector('input')) {
      const before = text.substring(0, index);
      const match = text.substring(index, index + term.length);
      const after = text.substring(index + term.length);

      label.innerHTML = before + '<span class="settings-search-highlight">' + match + '</span>' + after;
    }
  });
}

function clearSettingsHighlights(container) {
  const parent = container || document.getElementById('settings-panel');
  if (!parent) return;

  const highlights = parent.querySelectorAll('.settings-search-highlight');
  highlights.forEach(highlight => {
    const text = highlight.textContent;
    const textNode = document.createTextNode(text);
    highlight.parentNode.replaceChild(textNode, highlight);
  });
}

function performSearch(searchTerm) {
  clearSearchHighlights();
  searchMatches = [];
  currentMatchIndex = -1;

  if (!searchTerm || searchTerm.trim() === '') {
    updateSearchCounter();
    return;
  }

  const term = searchTerm.toLowerCase();
  const messages = messagesContainer.querySelectorAll('.message');

  messages.forEach((message, messageIndex) => {
    const content = message.querySelector('.message-content');
    if (!content) return;

    // Get all text nodes recursively
    const textNodes = [];
    const getTextNodes = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node);
      } else {
        node.childNodes.forEach(getTextNodes);
      }
    };
    getTextNodes(content);

    // Search and highlight in each text node
    textNodes.forEach((textNode) => {
      const text = textNode.textContent;
      const lowerText = text.toLowerCase();
      let startIndex = 0;
      let matchIndex;

      while ((matchIndex = lowerText.indexOf(term, startIndex)) !== -1) {
        // Split the text node and wrap the match
        const before = text.substring(0, matchIndex);
        const match = text.substring(matchIndex, matchIndex + term.length);
        const after = text.substring(matchIndex + term.length);

        const beforeNode = document.createTextNode(before);
        const matchNode = document.createElement('mark');
        matchNode.className = 'search-highlight';
        matchNode.textContent = match;
        const afterNode = document.createTextNode(after);

        const parent = textNode.parentNode;
        parent.insertBefore(beforeNode, textNode);
        parent.insertBefore(matchNode, textNode);
        parent.insertBefore(afterNode, textNode);
        parent.removeChild(textNode);

        searchMatches.push({ element: matchNode, message });

        // Continue searching in the "after" text
        textNode = afterNode;
        startIndex = 0;
      }
    });
  });

  // Navigate to first match if any
  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    highlightCurrentMatch();
  }

  updateSearchCounter();
}

function clearSearchHighlights() {
  const highlights = messagesContainer.querySelectorAll('.search-highlight');
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    const text = document.createTextNode(highlight.textContent);
    parent.replaceChild(text, highlight);
    parent.normalize(); // Merge adjacent text nodes
  });
}

function navigateToMatch(direction) {
  if (searchMatches.length === 0) return;

  if (direction === 'next') {
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  } else if (direction === 'prev') {
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  }

  highlightCurrentMatch();
  updateSearchCounter();
}

function highlightCurrentMatch() {
  // Remove active class from all matches
  searchMatches.forEach((match) => {
    match.element.classList.remove('active');
  });

  // Add active class to current match
  if (currentMatchIndex >= 0 && currentMatchIndex < searchMatches.length) {
    const currentMatch = searchMatches[currentMatchIndex];
    currentMatch.element.classList.add('active');

    // Scroll to the match
    currentMatch.element.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}

function updateSearchCounter() {
  if (chatSearchCurrent && chatSearchTotal) {
    chatSearchCurrent.textContent = searchMatches.length > 0 ? currentMatchIndex + 1 : 0;
    chatSearchTotal.textContent = searchMatches.length;
  }

  // Enable/disable navigation buttons
  const hasMatches = searchMatches.length > 0;
  if (chatSearchPrevBtn) chatSearchPrevBtn.disabled = !hasMatches;
  if (chatSearchNextBtn) chatSearchNextBtn.disabled = !hasMatches;
}

// Context Menu System
let contextMenu = null;
let contextMenuTarget = null;

function setupContextMenu() {
  contextMenu = document.getElementById('context-menu');

  // Global click to close context menu
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Prevent default context menu on messages
  messagesContainer.addEventListener('contextmenu', (e) => {
    const message = e.target.closest('.message');
    if (message) {
      e.preventDefault();
      showMessageContextMenu(e, message);
    }
  });

  // Context menu on message input
  const messageInput = document.getElementById('message-input');
  if (messageInput) {
    messageInput.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showInputContextMenu(e);
    });
  }

  // Escape to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenu && contextMenu.style.display !== 'none') {
      hideContextMenu();
    }
  });
}

function showMessageContextMenu(e, message) {
  const isUserMessage = message.classList.contains('user');
  const isAssistantMessage = message.classList.contains('assistant');
  const messageIndex = Array.from(messagesContainer.children).indexOf(message);

  const items = [];

  // Copy message
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M6 3V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.5"/></svg>',
    text: 'Copy Message',
    action: () => copyMessageText(message)
  });

  // Export message
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    text: 'Export Message',
    action: () => exportSingleMessage(message)
  });

  items.push({ separator: true });

  // Edit message
  if (isUserMessage) {
    items.push({
      icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
      text: 'Edit Message',
      action: () => editMessageFromContext(message)
    });
  }

  // Regenerate
  if (isAssistantMessage) {
    items.push({
      icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M13 7a5 5 0 1 0-1.5 3.5M13 4v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      text: 'Regenerate',
      action: () => regenerateFromContext(message)
    });
  }

  // Branch from here
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M5 2v7M5 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 2v3.5M11 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 7h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    text: 'Branch from Here',
    action: () => branchFromContext(message)
  });

  items.push({ separator: true });

  // Pin/Unpin
  const isPinned = message.classList.contains('pinned');
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v6M5 5l3-3 3 3M8 8v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    text: isPinned ? 'Unpin Message' : 'Pin Message',
    action: () => togglePinFromContext(message)
  });

  // Hide/Show
  const isHidden = message.classList.contains('hidden-message');
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M1 8s2-5 7-5 7 5 7 5-2 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>',
    text: isHidden ? 'Show Message' : 'Hide Message',
    action: () => toggleHideFromContext(message)
  });

  items.push({ separator: true });

  // Delete
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    text: 'Delete Message',
    danger: true,
    action: () => deleteMessageFromContext(message)
  });

  showContextMenuAt(e.clientX, e.clientY, items);
  contextMenuTarget = message;
}

function showInputContextMenu(e) {
  const messageInput = document.getElementById('message-input');

  const items = [];

  // Paste
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><rect x="5" y="2" width="6" height="2" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M4 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1" stroke="currentColor" stroke-width="1.5"/></svg>',
    text: 'Paste',
    action: async () => {
      try {
        const text = await navigator.clipboard.readText();
        messageInput.value += text;
        messageInput.focus();
      } catch (err) {
        console.error('Failed to paste:', err);
      }
    }
  });

  // Clear
  items.push({
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    text: 'Clear Input',
    action: () => {
      messageInput.value = '';
      messageInput.focus();
    }
  });

  showContextMenuAt(e.clientX, e.clientY, items);
}

function showContextMenuAt(x, y, items) {
  if (!contextMenu) return;

  const itemsContainer = contextMenu.querySelector('.context-menu-items');
  itemsContainer.innerHTML = '';

  items.forEach(item => {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      itemsContainer.appendChild(separator);
    } else {
      const button = document.createElement('button');
      button.className = 'context-menu-item';
      if (item.danger) button.classList.add('danger');
      if (item.disabled) button.classList.add('disabled');

      button.innerHTML = `
        <span class="context-menu-item-icon">${item.icon}</span>
        <span class="context-menu-item-text">${item.text}</span>
        ${item.shortcut ? `<span class="context-menu-item-shortcut">${item.shortcut}</span>` : ''}
      `;

      button.addEventListener('click', () => {
        item.action();
        hideContextMenu();
      });

      itemsContainer.appendChild(button);
    }
  });

  // Position the menu
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;

  // Adjust if menu goes off-screen
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
    contextMenuTarget = null;
  }
}

// Context menu action helpers
function copyMessageText(message) {
  const content = message.querySelector('.message-content');
  if (content) {
    const text = content.innerText || content.textContent;
    navigator.clipboard.writeText(text).then(() => {
      showSuccess('Copied to Clipboard', 'Message text copied successfully');
    }).catch(err => {
      showError('Copy Failed', 'Could not copy message to clipboard');
      console.error('Failed to copy:', err);
    });
  }
}

function editMessageFromContext(message) {
  const editBtn = message.querySelector('.message-edit-btn');
  if (editBtn) {
    editBtn.click();
  }
}

function regenerateFromContext(message) {
  const regenBtn = message.querySelector('.message-regen-btn');
  if (regenBtn) {
    regenBtn.click();
  }
}

function branchFromContext(message) {
  const branchBtn = message.querySelector('.message-branch-btn');
  if (branchBtn) {
    branchBtn.click();
  }
}

function togglePinFromContext(message) {
  const pinBtn = message.querySelector('.message-pin-btn');
  if (pinBtn) {
    pinBtn.click();
  }
}

function toggleHideFromContext(message) {
  const hideBtn = message.querySelector('.message-hide-btn');
  if (hideBtn) {
    hideBtn.click();
  }
}

function deleteMessageFromContext(message) {
  const deleteBtn = message.querySelector('.message-delete-btn');
  if (deleteBtn) {
    deleteBtn.click();
  }
}

// Confirmation Dialog System
function showConfirmDialog(options) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const overlay = modal.querySelector('.confirm-overlay');
    const icon = document.getElementById('confirm-icon');
    const title = document.getElementById('confirm-title');
    const message = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const confirmBtn = document.getElementById('confirm-confirm-btn');

    // Set content
    title.textContent = options.title || 'Confirm';
    message.textContent = options.message || 'Are you sure?';
    confirmBtn.textContent = options.confirmText || 'Confirm';

    // Set icon
    const iconType = options.type || 'danger';
    icon.className = `confirm-icon ${iconType}`;

    const iconSvgs = {
      danger: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    icon.innerHTML = iconSvgs[iconType] || iconSvgs.danger;

    // Set button style
    confirmBtn.className = `btn-primary ${iconType === 'danger' ? 'danger' : ''}`;

    // Show modal
    modal.style.display = 'flex';

    // Handle confirm
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    // Handle cancel
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Handle overlay click
    const handleOverlayClick = () => {
      cleanup();
      resolve(false);
    };

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(false);
      }
    };

    // Cleanup function
    const cleanup = () => {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleOverlayClick);
      document.removeEventListener('keydown', handleEscape);
    };

    // Add event listeners
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscape);
  });
}

// Loading Indicator System
let loadingOverlay = null;

function showLoading(text = 'Loading...') {
  if (!loadingOverlay) {
    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner-large"></div>
        <p class="loading-text">${text}</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);
  } else {
    loadingOverlay.querySelector('.loading-text').textContent = text;
    loadingOverlay.style.display = 'flex';
  }
}

function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }
}

// Saving Indicator System
function showSavingIndicator(buttonElement) {
  let indicator = buttonElement.nextElementSibling;

  if (!indicator || !indicator.classList.contains('saving-indicator')) {
    indicator = document.createElement('span');
    indicator.className = 'saving-indicator';
    indicator.innerHTML = `
      <div class="saving-indicator-spinner"></div>
      <span>Saving...</span>
    `;
    buttonElement.parentNode.insertBefore(indicator, buttonElement.nextSibling);
  }

  indicator.classList.remove('saved');
  indicator.querySelector('span').textContent = 'Saving...';
  indicator.classList.add('show');

  return indicator;
}

function showSavedIndicator(indicator) {
  indicator.classList.add('saved');
  indicator.querySelector('span').textContent = 'Saved!';
  indicator.querySelector('.saving-indicator-spinner').style.display = 'none';

  setTimeout(() => {
    indicator.classList.remove('show');
    setTimeout(() => {
      indicator.classList.remove('saved');
      if (indicator.querySelector('.saving-indicator-spinner')) {
        indicator.querySelector('.saving-indicator-spinner').style.display = 'block';
      }
    }, 200);
  }, 2000);
}

// Apply view mode
async function applyViewMode(mode) {
  const body = document.body;

  // Remove all view mode classes
  body.classList.remove('view-compact', 'view-cozy', 'view-comfortable', 'view-visual-novel');

  // Add the selected mode
  body.classList.add(`view-${mode}`);

  // Store preference
  localStorage.setItem('claudia-view-mode', mode);

  // Initialize expression display when switching to VN mode
  if (mode === 'visual-novel') {
    try {
      await updateExpressionDisplay();
    } catch (error) {
      console.error('Failed to initialize expression display:', error);
    }
  }
}

// Load saved view mode
async function loadSavedViewMode() {
  const savedMode = localStorage.getItem('claudia-view-mode') || 'cozy';
  const viewModeSelect = document.getElementById('view-mode-select');
  if (viewModeSelect) {
    viewModeSelect.value = savedMode;
  }
  await applyViewMode(savedMode);
}

// Apply font size
function applyFontSize(scale) {
  const root = document.documentElement;

  // Calculate font size based on scale (80-140%)
  const baseFontSize = 14; // Default base size in px
  const newFontSize = (baseFontSize * scale) / 100;

  root.style.setProperty('--base-font-size', `${newFontSize}px`);
  root.style.fontSize = `${newFontSize}px`;

  // Update the display value
  const fontSizeValue = document.getElementById('font-size-value');
  if (fontSizeValue) {
    fontSizeValue.textContent = `${scale}%`;
  }

  // Store preference
  localStorage.setItem('claudia-font-size', scale.toString());
}

// Load saved font size
function loadSavedFontSize() {
  const savedSize = parseInt(localStorage.getItem('claudia-font-size') || '100');
  const fontSizeSlider = document.getElementById('font-size-slider');
  if (fontSizeSlider) {
    fontSizeSlider.value = savedSize;
  }
  applyFontSize(savedSize);
}

// Toggle timestamps
function toggleTimestamps(show) {
  const body = document.body;
  if (show) {
    body.classList.add('show-timestamps');
  } else {
    body.classList.remove('show-timestamps');
  }

  // Store preference
  localStorage.setItem('claudia-show-timestamps', show.toString());
}

// Load saved timestamp preference
function loadSavedTimestampPreference() {
  const savedPref = localStorage.getItem('claudia-show-timestamps') === 'true';
  const timestampToggle = document.getElementById('show-timestamps-toggle');
  if (timestampToggle) {
    timestampToggle.checked = savedPref;
  }
  toggleTimestamps(savedPref);
}

// Apply layout mode
function applyLayoutMode(mode) {
  const body = document.body;

  // Remove all layout classes from body ONLY
  body.classList.remove('layout-compact', 'layout-spacious');

  // Add the new layout class to body ONLY
  // (CSS selectors like `.layout-spacious .app-container` need the layout class on an ancestor)
  body.classList.add(`layout-${mode}`);

  // Move roleplay panel into right sidebar for spacious mode
  const roleplayPanel = document.getElementById('roleplay-panel');
  const roleplaySidebarTab = document.getElementById('roleplay-sidebar-tab');

  if (mode === 'spacious' && roleplayPanel && roleplaySidebarTab) {
    // Move roleplay panel content into right sidebar
    roleplaySidebarTab.appendChild(roleplayPanel);
  } else if (mode === 'compact' && roleplayPanel) {
    // Move it back to its original location (before the toast container)
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer && toastContainer.parentNode) {
      toastContainer.parentNode.insertBefore(roleplayPanel, toastContainer);
    }
  }

  // Store preference
  localStorage.setItem('claudia-layout-mode', mode);
}

// Load saved layout mode
function loadSavedLayoutMode() {
  const savedMode = localStorage.getItem('claudia-layout-mode') || 'spacious';
  const layoutModeSelect = document.getElementById('layout-mode-select');
  if (layoutModeSelect) {
    layoutModeSelect.value = savedMode;
  }
  applyLayoutMode(savedMode);
}

// Show export modal
function showExportModal() {
  const exportModal = document.getElementById('export-modal');
  if (exportModal) {
    exportModal.style.display = 'flex';
  }
}

// Hide export modal
function hideExportModal() {
  const exportModal = document.getElementById('export-modal');
  if (exportModal) {
    exportModal.style.display = 'none';
  }
}

// Export chat history (opens export modal)
async function exportChatHistory() {
  showExportModal();
}

// Export as JSON
async function exportAsJSON() {
  try {
    setStatus('Exporting as JSON...', 'default');
    hideExportModal();
    const filePath = await invoke('export_chat_history');
    setStatus('Ready');
    showSuccess('Exported as JSON', `Successfully exported to ${filePath}`, 4000);
  } catch (error) {
    console.error('Export failed:', error);
    if (error && !error.toString().includes('cancelled')) {
      setStatus('Ready');
      showError('Export Failed', `Failed to export: ${error}`);
    } else {
      setStatus('Ready');
    }
  }
}

// Export as HTML
async function exportAsHTML() {
  try {
    setStatus('Exporting as HTML...', 'default');
    hideExportModal();
    const filePath = await invoke('export_chat_as_html');
    setStatus('Ready');
    showSuccess('Exported as HTML', `Successfully exported to ${filePath}`, 4000);
  } catch (error) {
    console.error('Export failed:', error);
    if (error && !error.toString().includes('cancelled')) {
      setStatus('Ready');
      showError('Export Failed', `Failed to export: ${error}`);
    } else {
      setStatus('Ready');
    }
  }
}

// Export as Markdown
async function exportAsMarkdown() {
  try {
    setStatus('Exporting as Markdown...', 'default');
    hideExportModal();
    const filePath = await invoke('export_chat_as_markdown');
    setStatus('Ready');
    showSuccess('Exported as Markdown', `Successfully exported to ${filePath}`, 4000);
  } catch (error) {
    console.error('Export failed:', error);
    if (error && !error.toString().includes('cancelled')) {
      setStatus('Ready');
      showError('Export Failed', `Failed to export: ${error}`);
    } else {
      setStatus('Ready');
    }
  }
}

// Export as Plain Text
async function exportAsText() {
  try {
    setStatus('Exporting as text...', 'default');
    hideExportModal();
    const filePath = await invoke('export_chat_as_text');
    setStatus('Ready');
    showSuccess('Exported as Text', `Successfully exported to ${filePath}`, 4000);
  } catch (error) {
    console.error('Export failed:', error);
    if (error && !error.toString().includes('cancelled')) {
      setStatus('Ready');
      showError('Export Failed', `Failed to export: ${error}`);
    } else {
      setStatus('Ready');
    }
  }
}

// Export as PDF (generates HTML then prints)
async function exportAsPDF() {
  try {
    setStatus('Generating PDF...', 'default');
    hideExportModal();

    // Get chat history and format as HTML
    const history = await invoke('get_chat_history');
    const character = currentCharacter;

    // Create a formatted HTML page for printing
    const htmlContent = generatePrintableHTML(history, character);

    // Open print dialog with the formatted content
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Wait a moment for content to load, then trigger print
    setTimeout(() => {
      printWindow.print();
    }, 250);

    setStatus('Ready');
    showInfo('PDF Export', 'Print dialog opened. Select "Save as PDF" to create a PDF file.');
  } catch (error) {
    console.error('PDF export failed:', error);
    setStatus('Ready');
    showError('Export Failed', `Failed to generate PDF: ${error}`);
  }
}

// Generate printable HTML content
function generatePrintableHTML(history, character) {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Chat with ${character.name}</title>
      <style>
        @page { margin: 2cm; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background: white;
          color: #333;
        }
        h1 {
          color: #333;
          border-bottom: 2px solid #ddd;
          padding-bottom: 10px;
          margin-bottom: 24px;
        }
        .message {
          margin: 20px 0;
          padding: 15px;
          border-radius: 8px;
          background: #f9f9f9;
          border-left: 4px solid #ddd;
          page-break-inside: avoid;
        }
        .message.user {
          border-left-color: #4CAF50;
        }
        .message.assistant {
          border-left-color: #2196F3;
        }
        .role {
          font-weight: bold;
          margin-bottom: 8px;
          color: #555;
        }
        .content {
          line-height: 1.6;
          color: #333;
          white-space: pre-wrap;
        }
        @media print {
          body { background: white; }
          .message { box-shadow: none; }
        }
      </style>
    </head>
    <body>
      <h1>Chat with ${character.name}</h1>
  `;

  for (const msg of history) {
    const roleClass = msg.role === 'user' ? 'user' : 'assistant';
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    const content = (msg.swipes && msg.swipes.length > 0
      ? msg.swipes[msg.current_swipe || 0]
      : msg.content
    ).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    html += `
      <div class="message ${roleClass}">
        <div class="role">${roleLabel}</div>
        <div class="content">${content}</div>
      </div>
    `;
  }

  html += `
    </body>
    </html>
  `;

  return html;
}

// Copy conversation to clipboard
async function copyToClipboard() {
  try {
    setStatus('Copying to clipboard...', 'default');
    hideExportModal();

    // Get chat history
    const history = await invoke('get_chat_history');
    const character = currentCharacter;

    // Build formatted text
    let text = `Chat with ${character.name}\n`;
    text += '='.repeat(40) + '\n\n';

    for (const msg of history) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.swipes && msg.swipes.length > 0
        ? msg.swipes[msg.current_swipe || 0]
        : msg.content;
      text += `${role}: ${content}\n\n`;
    }

    // Copy to clipboard using Clipboard API
    await navigator.clipboard.writeText(text);

    setStatus('Ready');
    showSuccess('Copied to Clipboard', 'Conversation copied to clipboard successfully!');
  } catch (error) {
    console.error('Copy to clipboard failed:', error);
    setStatus('Ready');
    showError('Copy Failed', `Failed to copy to clipboard: ${error}`);
  }
}

// Export a single message to clipboard
async function exportSingleMessage(messageDiv) {
  try {
    // Get message content
    const contentDiv = messageDiv.querySelector('.message-content');
    if (!contentDiv) return;

    const messageText = contentDiv.textContent.trim();
    const role = messageDiv.classList.contains('user') ? 'User' : 'Assistant';

    // Format the message
    const formattedText = `${role}: ${messageText}`;

    // Copy to clipboard
    await navigator.clipboard.writeText(formattedText);

    showSuccess('Message Copied', 'Message copied to clipboard successfully!');
  } catch (error) {
    console.error('Failed to export message:', error);
    showError('Export Failed', `Failed to copy message: ${error}`);
  }
}

// Import chat history
async function importChatHistory() {
  try {
    setStatus('Importing chat...', 'default');
    const messageCount = await invoke('import_chat_history');

    // Reload the chat history
    await loadChatHistory();

    setStatus('Ready');
    showSuccess('Chat Imported', `Successfully imported ${messageCount} messages!`);
  } catch (error) {
    console.error('Import failed:', error);
    if (error === 'No file selected' || error.toString().includes('cancelled')) {
      setStatus('Ready');
    } else {
      setStatus('Ready');
      showError('Import Failed', `Failed to import chat: ${error}`);
    }
  }
}

// Helper function to get avatar URL
async function getAvatarUrl(avatarFilename) {
  if (!avatarFilename) return null;
  try {
    const fullPath = await invoke('get_avatar_full_path', { avatarFilename });
    console.log('Avatar full path:', fullPath);

    // Try to use convertFileSrc if available
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) {
      const url = window.__TAURI__.core.convertFileSrc(fullPath);
      console.log('Converted URL:', url);
      return url;
    } else {
      // Fallback to using the path directly with proper protocol
      const url = `asset://localhost/${fullPath}`;
      console.log('Using asset protocol URL:', url);
      return url;
    }
  } catch (error) {
    console.error('Failed to get avatar URL for', avatarFilename, ':', error);
    return null;
  }
}

// Show avatar in modal
function showAvatarModal(avatarUrl) {
  const modal = document.getElementById('avatar-modal');
  const modalImg = document.getElementById('avatar-modal-img');

  modalImg.src = avatarUrl;
  modal.style.display = 'flex';

  // Fade in animation
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.style.opacity = '1';
    modal.style.transition = 'opacity 0.2s ease';
  }, 10);
}

// Hide avatar modal
function hideAvatarModal() {
  const modal = document.getElementById('avatar-modal');
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.style.display = 'none';
  }, 200);
}

// Make avatar clickable
function makeAvatarClickable(avatarElement, avatarUrl) {
  if (!avatarUrl) return;

  avatarElement.addEventListener('click', (e) => {
    e.stopPropagation();
    showAvatarModal(avatarUrl);
  });
}

// Format timestamp for display
function formatTimestamp(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // Just now (less than 1 minute)
  if (seconds < 60) {
    return 'Just now';
  }

  // Minutes ago (less than 1 hour)
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  // Today (show time)
  if (days === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // Yesterday
  if (days === 1) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  // This week (show day name)
  if (days < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // Older (show date)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// Auto-resize textarea
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Helper function to render assistant message content with character name
function renderAssistantContent(contentDiv, messageText) {
  // Clear existing content
  contentDiv.innerHTML = '';

  // Add character name indicator
  if (currentCharacter && currentCharacter.name) {
    const nameIndicator = document.createElement('div');
    nameIndicator.className = 'character-name-indicator';
    nameIndicator.textContent = currentCharacter.name;
    contentDiv.appendChild(nameIndicator);
  }

  // Add message content
  const messageContent = document.createElement('div');
  messageContent.innerHTML = marked.parse(messageText);
  contentDiv.appendChild(messageContent);

  // Apply syntax highlighting to code blocks
  messageContent.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
    addCopyButtonToCode(block);
  });

  return messageContent;
}

// Add message to chat
async function addMessage(content, isUser = false, skipActions = false, timestamp = null, characterInfo = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;

  // For group chat messages, add a data attribute
  if (characterInfo) {
    messageDiv.dataset.characterId = characterInfo.id;
  }

  const avatar = document.createElement('div');
  avatar.className = 'avatar-circle';

  // Set avatar image for assistant messages
  // Use characterInfo if provided (for group chats), otherwise use currentCharacter
  const characterToShow = characterInfo || currentCharacter;
  if (!isUser && characterToShow && characterToShow.avatar_path) {
    getAvatarUrl(characterToShow.avatar_path).then(url => {
      if (url) {
        avatar.style.backgroundImage = `url('${url}')`;
        makeAvatarClickable(avatar, url);
      }
    });
  }

  // Detect and update expression for assistant messages
  if (!isUser) {
    try {
      const expressionName = await detectMessageExpression(content);
      if (expressionName) {
        await updateExpressionDisplay(expressionName);
      }
    } catch (error) {
      console.error('Failed to detect/display expression:', error);
    }
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (isUser) {
    // User messages: plain text
    const p = document.createElement('p');
    p.textContent = content;
    contentDiv.appendChild(p);

    // Add timestamp if provided
    if (timestamp) {
      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'message-timestamp';
      timestampDiv.textContent = formatTimestamp(timestamp);
      contentDiv.appendChild(timestampDiv);
    }
  } else {
    // Assistant messages: render as markdown
    // Add character badge for group chats, or simple name indicator for 1-on-1
    const charToDisplay = characterInfo || currentCharacter;
    if (charToDisplay && charToDisplay.name) {
      if (characterInfo) {
        // Group chat: show prominent character badge
        const badge = document.createElement('div');
        badge.className = 'character-badge';

        // Generate consistent color for character
        const badgeColor = generateCharacterColor(characterInfo.id);
        badge.style.setProperty('--badge-color', badgeColor);

        const badgeAvatar = document.createElement('div');
        badgeAvatar.className = 'character-badge-avatar';

        if (characterInfo.avatar_path) {
          getAvatarUrl(characterInfo.avatar_path).then(url => {
            if (url) {
              badgeAvatar.style.backgroundImage = `url('${url}')`;
            } else {
              badgeAvatar.textContent = characterInfo.name.charAt(0).toUpperCase();
            }
          });
        } else {
          badgeAvatar.textContent = characterInfo.name.charAt(0).toUpperCase();
        }

        const badgeName = document.createElement('span');
        badgeName.className = 'character-badge-name';
        badgeName.textContent = characterInfo.name;

        badge.appendChild(badgeAvatar);
        badge.appendChild(badgeName);
        contentDiv.appendChild(badge);
      } else {
        // 1-on-1 chat: simple name indicator
        const nameIndicator = document.createElement('div');
        nameIndicator.className = 'character-name-indicator';
        nameIndicator.textContent = charToDisplay.name;
        contentDiv.appendChild(nameIndicator);
      }
    }

    const messageContent = document.createElement('div');
    messageContent.innerHTML = marked.parse(content);
    contentDiv.appendChild(messageContent);

    // Apply syntax highlighting to code blocks
    messageContent.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);

      // Add copy button to code blocks
      const pre = block.parentElement;
      if (!pre.querySelector('.copy-btn')) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="5" y="5" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none" rx="1"/>
          <path d="M3 11V3a1 1 0 0 1 1-1h8" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>`;
        copyBtn.title = 'Copy code';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(block.textContent);
          copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="5" y="5" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none" rx="1"/>
              <path d="M3 11V3a1 1 0 0 1 1-1h8" stroke="currentColor" stroke-width="1.5" fill="none"/>
            </svg>`;
            copyBtn.classList.remove('copied');
          }, 2000);
        });
        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
      }
    });

    // Add timestamp if provided
    if (timestamp) {
      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'message-timestamp';
      timestampDiv.textContent = formatTimestamp(timestamp);
      contentDiv.appendChild(timestampDiv);
    }
  }

  // Build message structure
  if (!skipActions) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    if (isUser) {
      // User message: simple structure with edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'message-action-btn';
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M10 1L13 4L5 12H2V9L10 1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', () => handleEditMessage(messageDiv, content));
      actionsDiv.appendChild(editBtn);

      // Branch button
      const branchBtn = document.createElement('button');
      branchBtn.className = 'message-action-btn';
      branchBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 2V12M2 2C2.82843 2 3.5 2.67157 3.5 3.5C3.5 4.32843 2.82843 5 2 5M2 2C1.17157 2 0.5 2.67157 0.5 3.5C0.5 4.32843 1.17157 5 2 5M2 5V7M2 7C2 9 3 10 5 10H10.5M2 7V12M10.5 10C10.5 10.8284 11.1716 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.1716 8.5 10.5 9.17157 10.5 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      branchBtn.title = 'Create branch from here';
      branchBtn.addEventListener('click', () => handleCreateBranch(messageDiv));
      actionsDiv.appendChild(branchBtn);

      // Copy message button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'message-action-btn';
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M5 3V2C5 1.44772 5.44772 1 6 1H12C12.5523 1 13 1.44772 13 2V8C13 8.55228 12.5523 9 12 9H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
      copyBtn.title = 'Copy message';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content);
        // Visual feedback
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = originalHTML;
        }, 2000);
      });
      actionsDiv.appendChild(copyBtn);

      // Pin button
      const pinBtn = document.createElement('button');
      pinBtn.className = 'message-action-btn message-pin-btn';
      pinBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 11V5M4.5 5L7 2.5L9.5 5M7 11L7 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      pinBtn.title = 'Pin message';
      pinBtn.addEventListener('click', () => handleTogglePin(messageDiv));
      actionsDiv.appendChild(pinBtn);

      // Hide button
      const hideBtn = document.createElement('button');
      hideBtn.className = 'message-action-btn message-hide-btn';
      hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 7 3 3 7 3C11 3 13 7 13 7C13 7 11 11 7 11C3 11 1 7 1 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
      </svg>`;
      hideBtn.title = 'Hide message';
      hideBtn.addEventListener('click', () => handleToggleHidden(messageDiv));
      actionsDiv.appendChild(hideBtn);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'message-action-btn message-delete-btn';
      deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4H12M5 4V3C5 2.44772 5.44772 2 6 2H8C8.55228 2 9 2.44772 9 3V4M11 4L10.5 11C10.5 11.5523 10.0523 12 9.5 12H4.5C3.94772 12 3.5 11.5523 3.5 11L3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', () => handleDeleteMessage(messageDiv));
      actionsDiv.appendChild(deleteBtn);

      messageDiv.appendChild(contentDiv);
      messageDiv.appendChild(actionsDiv);
    } else {
      // Assistant message: structure with swipe controls
      const regenerateBtn = document.createElement('button');
      regenerateBtn.className = 'message-action-btn';
      regenerateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 3.68629 3.68629 1 7 1C10.3137 1 13 3.68629 13 7C13 10.3137 10.3137 13 7 13C5.5 13 4.16667 12.3333 3 11.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M1 10V7H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      regenerateBtn.title = 'Regenerate response';
      regenerateBtn.addEventListener('click', () => handleRegenerateMessage(messageDiv));
      actionsDiv.appendChild(regenerateBtn);

      // Continue button
      const continueBtn = document.createElement('button');
      continueBtn.className = 'message-action-btn message-continue-btn';
      continueBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 7H11M11 7L7 3M11 7L7 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      continueBtn.title = 'Continue message';
      continueBtn.addEventListener('click', () => handleContinueMessage(messageDiv));
      actionsDiv.appendChild(continueBtn);

      // Branch button
      const branchBtn = document.createElement('button');
      branchBtn.className = 'message-action-btn';
      branchBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 2V12M2 2C2.82843 2 3.5 2.67157 3.5 3.5C3.5 4.32843 2.82843 5 2 5M2 2C1.17157 2 0.5 2.67157 0.5 3.5C0.5 4.32843 1.17157 5 2 5M2 5V7M2 7C2 9 3 10 5 10H10.5M2 7V12M10.5 10C10.5 10.8284 11.1716 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.1716 8.5 10.5 9.17157 10.5 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      branchBtn.title = 'Create branch from here';
      branchBtn.addEventListener('click', () => handleCreateBranch(messageDiv));
      actionsDiv.appendChild(branchBtn);

      // Pin button
      const pinBtn = document.createElement('button');
      pinBtn.className = 'message-action-btn message-pin-btn';
      pinBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 11V5M4.5 5L7 2.5L9.5 5M7 11L7 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      pinBtn.title = 'Pin message';
      pinBtn.addEventListener('click', () => handleTogglePin(messageDiv));
      actionsDiv.appendChild(pinBtn);

      // Hide button
      const hideBtn = document.createElement('button');
      hideBtn.className = 'message-action-btn message-hide-btn';
      hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 7 3 3 7 3C11 3 13 7 13 7C13 7 11 11 7 11C3 11 1 7 1 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
      </svg>`;
      hideBtn.title = 'Hide message';
      hideBtn.addEventListener('click', () => handleToggleHidden(messageDiv));
      actionsDiv.appendChild(hideBtn);

      // Copy message button
      const copyMsgBtn = document.createElement('button');
      copyMsgBtn.className = 'message-action-btn';
      copyMsgBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M5 3V2C5 1.44772 5.44772 1 6 1H12C12.5523 1 13 1.44772 13 2V8C13 8.55228 12.5523 9 12 9H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
      copyMsgBtn.title = 'Copy message';
      copyMsgBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content);
        // Visual feedback
        const originalHTML = copyMsgBtn.innerHTML;
        copyMsgBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        setTimeout(() => {
          copyMsgBtn.innerHTML = originalHTML;
        }, 2000);
      });
      actionsDiv.appendChild(copyMsgBtn);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'message-action-btn message-delete-btn';
      deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4H12M5 4V3C5 2.44772 5.44772 2 6 2H8C8.55228 2 9 2.44772 9 3V4M11 4L10.5 11C10.5 11.5523 10.0523 12 9.5 12H4.5C3.94772 12 3.5 11.5523 3.5 11L3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', () => handleDeleteMessage(messageDiv));
      actionsDiv.appendChild(deleteBtn);

      // Create swipe wrapper
      const swipeWrapper = document.createElement('div');
      swipeWrapper.style.display = 'flex';
      swipeWrapper.style.flexDirection = 'column';
      swipeWrapper.appendChild(contentDiv);

      const swipeControls = createSwipeControls(messageDiv);
      swipeWrapper.appendChild(swipeControls);

      messageDiv.appendChild(swipeWrapper);
      messageDiv.appendChild(actionsDiv);
    }
  } else {
    messageDiv.appendChild(contentDiv);
  }

  if (!isUser) {
    messageDiv.insertBefore(avatar, messageDiv.firstChild);
  }
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageDiv;
}

// Create swipe controls for assistant messages
function createSwipeControls(messageDiv) {
  const swipeControls = document.createElement('div');
  swipeControls.className = 'swipe-controls';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'swipe-btn swipe-prev';
  prevBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  prevBtn.title = 'Previous response';
  prevBtn.addEventListener('click', () => handleSwipeNavigation(messageDiv, -1));

  const counter = document.createElement('span');
  counter.className = 'swipe-counter';
  counter.textContent = '1/1';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'swipe-btn swipe-next';
  nextBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  nextBtn.title = 'Next response';
  nextBtn.addEventListener('click', () => handleSwipeNavigation(messageDiv, 1));

  swipeControls.appendChild(prevBtn);
  swipeControls.appendChild(counter);
  swipeControls.appendChild(nextBtn);

  // Initially hide if only one swipe
  updateSwipeControls(messageDiv, 0, 1);

  return swipeControls;
}

// Update swipe controls state
function updateSwipeControls(messageDiv, current, total) {
  const swipeControls = messageDiv.querySelector('.swipe-controls');
  if (!swipeControls) return;

  const counter = swipeControls.querySelector('.swipe-counter');
  const prevBtn = swipeControls.querySelector('.swipe-prev');
  const nextBtn = swipeControls.querySelector('.swipe-next');

  counter.textContent = `${current + 1}/${total}`;
  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === total - 1;

  // Show controls if more than one swipe
  if (total > 1) {
    swipeControls.classList.add('always-visible');
  } else {
    swipeControls.classList.remove('always-visible');
  }
}

// Handle swipe navigation
async function handleSwipeNavigation(messageDiv, direction) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  console.log('handleSwipeNavigation called:', { messageIndex, direction });

  try {
    const swipeInfo = await invoke('navigate_swipe', { messageIndex, direction });
    console.log('Received swipeInfo:', swipeInfo);

    // Update message content
    const contentDiv = messageDiv.querySelector('.message-content');
    console.log('Found contentDiv:', contentDiv);
    console.log('Setting content to:', swipeInfo.content);
    renderAssistantContent(contentDiv, swipeInfo.content);

    // Update swipe controls
    updateSwipeControls(messageDiv, swipeInfo.current, swipeInfo.total);
  } catch (error) {
    console.error('Failed to navigate swipe:', error);
  }
}

// Handle editing a user message
async function handleEditMessage(messageDiv, originalContent) {
  const contentDiv = messageDiv.querySelector('.message-content');
  const actionsDiv = messageDiv.querySelector('.message-actions');

  // Hide action buttons during edit
  actionsDiv.style.display = 'none';

  // Add visual feedback for edit mode
  messageDiv.classList.add('editing');
  messageDiv.style.border = '2px solid var(--accent)';
  messageDiv.style.background = 'var(--bg-tertiary)';
  messageDiv.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)';

  // Store original styles to restore later
  const originalStyles = {
    border: messageDiv.style.border,
    background: messageDiv.style.background,
    boxShadow: messageDiv.style.boxShadow
  };

  // Create edit form
  const editForm = document.createElement('form');
  editForm.className = 'message-edit-form';

  const textarea = document.createElement('textarea');
  textarea.className = 'message-edit-textarea';
  textarea.value = originalContent;
  textarea.rows = 3;
  autoResize(textarea);

  const editActions = document.createElement('div');
  editActions.className = 'message-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'message-edit-btn';
  saveBtn.textContent = 'Save & Resend';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'message-edit-btn';
  cancelBtn.textContent = 'Cancel';

  editActions.appendChild(saveBtn);
  editActions.appendChild(cancelBtn);
  editForm.appendChild(textarea);
  editForm.appendChild(editActions);

  // Auto-resize on input
  textarea.addEventListener('input', () => autoResize(textarea));

  // Replace content with edit form
  const originalHTML = contentDiv.innerHTML;
  contentDiv.innerHTML = '';
  contentDiv.appendChild(editForm);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // Helper to exit edit mode and restore styles
  const exitEditMode = () => {
    messageDiv.classList.remove('editing');
    messageDiv.style.border = originalStyles.border;
    messageDiv.style.background = originalStyles.background;
    messageDiv.style.boxShadow = originalStyles.boxShadow;
  };

  // Handle cancel
  cancelBtn.addEventListener('click', () => {
    contentDiv.innerHTML = originalHTML;
    actionsDiv.style.display = 'flex';
    exitEditMode();
  });

  // Handle save
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newContent = textarea.value.trim();

    if (!newContent || newContent === originalContent) {
      contentDiv.innerHTML = originalHTML;
      actionsDiv.style.display = 'flex';
      exitEditMode();
      return;
    }

    // Get the index of this message
    const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
    const messageIndex = allMessages.indexOf(messageDiv);

    // Disable form
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      // Get all messages from this point onward for undo
      const chatHistory = await invoke('get_chat_history');
      const messagesToRestore = chatHistory.slice(messageIndex);

      // Truncate history from this point
      await invoke('truncate_history_from', { index: messageIndex });

      // Remove all messages from this point forward in UI
      while (messagesContainer.children[messageIndex]) {
        messagesContainer.children[messageIndex].remove();
      }

      // Send the edited message
      await sendMessage(newContent);

      // Record undo action after successful edit
      recordUndoAction({
        type: UndoActionType.MESSAGE_EDIT,
        description: 'Edit message',
        messageIndex,
        originalMessages: messagesToRestore,
        newContent
      });

      // Edit complete - messageDiv will be removed, no need to exitEditMode
    } catch (error) {
      console.error('Failed to edit message:', error);
      contentDiv.innerHTML = originalHTML;
      actionsDiv.style.display = 'flex';
      exitEditMode();
      addMessage(`Error editing message: ${error}`, false);
    }
  });
}

// Handle regenerating an assistant message
async function handleRegenerateMessage(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  const regenerateBtn = messageDiv.querySelector('.message-action-btn');
  regenerateBtn.disabled = true;
  regenerateBtn.classList.add('loading');

  try {
    setStatus('Regenerating response...', 'default');

    // Use the new regenerate_at_index command which works on any message
    const swipeInfo = await invoke('regenerate_at_index', { messageIndex });

    // Update the message content
    const contentDiv = messageDiv.querySelector('.message-content');
    renderAssistantContent(contentDiv, swipeInfo.content);

    // Update swipe controls
    updateSwipeControls(messageDiv, swipeInfo.current, swipeInfo.total);

    setStatus('Regeneration complete', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to regenerate message:', error);
    setStatus(`Regeneration failed: ${error}`, 'error');
  } finally {
    regenerateBtn.disabled = false;
    regenerateBtn.classList.remove('loading');
  }
}

// Generate a new swipe for an existing assistant message
async function generateSwipe(messageDiv, userMessage) {
  setStatus('Regenerating response...', 'default');

  // Check if streaming is enabled
  let streamEnabled = false;
  try {
    const config = await invoke('get_api_config');
    streamEnabled = config.stream || false;
  } catch (error) {
    console.error('Failed to get config:', error);
  }

  if (streamEnabled) {
    await generateSwipeStream(messageDiv, userMessage);
  } else {
    await generateSwipeNonStream(messageDiv, userMessage);
  }
}

// Generate swipe using non-streaming
async function generateSwipeNonStream(messageDiv, userMessage) {
  try {
    const response = await invoke('generate_response_only');

    // Add as a swipe
    const swipeInfo = await invoke('add_swipe_to_last_assistant', { content: response });

    // Update the message content
    const contentDiv = messageDiv.querySelector('.message-content');
    renderAssistantContent(contentDiv, swipeInfo.content);

    // Update swipe controls
    updateSwipeControls(messageDiv, swipeInfo.current, swipeInfo.total);

    setStatus('Regeneration complete', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
    const regenerateBtn = messageDiv.querySelector('.message-action-btn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.classList.remove('loading');
    }
  } catch (error) {
    setStatus(`Regeneration failed: ${error.substring(0, 40)}...`, 'error');
    const regenerateBtn = messageDiv.querySelector('.message-action-btn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.classList.remove('loading');
    }
    addMessage(`Error regenerating message: ${error}`, false);
  }
}

// Generate swipe using streaming
async function generateSwipeStream(messageDiv, userMessage) {
  setStatus('Streaming regeneration...', 'streaming');

  let fullContent = '';
  const contentDiv = messageDiv.querySelector('.message-content');

  // Set up event listeners for streaming
  const { listen } = window.__TAURI__.event;

  const tokenUnlisten = await listen('chat-token', (event) => {
    const token = event.payload;
    fullContent += token;

    // Update content with markdown rendering
    renderAssistantContent(contentDiv, fullContent);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  const completeUnlisten = await listen('chat-complete', async () => {
    // Add as a swipe
    try {
      const swipeInfo = await invoke('add_swipe_to_last_assistant', { content: fullContent });

      // Update swipe controls
      updateSwipeControls(messageDiv, swipeInfo.current, swipeInfo.total);
    } catch (error) {
      console.error('Failed to add swipe:', error);
    }

    setStatus('Regeneration complete', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
    const regenerateBtn = messageDiv.querySelector('.message-action-btn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.classList.remove('loading');
    }
    tokenUnlisten();
    completeUnlisten();
  });

  try {
    await invoke('generate_response_stream');
  } catch (error) {
    tokenUnlisten();
    completeUnlisten();
    setStatus(`Regeneration failed: ${error.substring(0, 40)}...`, 'error');
    const regenerateBtn = messageDiv.querySelector('.message-action-btn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.classList.remove('loading');
    }
    addMessage(`Error: ${error}`, false);
  }
}

// Helper to add copy button to code blocks
function addCopyButtonToCode(block) {
  const pre = block.parentElement;
  if (pre && !pre.querySelector('.copy-btn')) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none" rx="1"/>
      <path d="M3 11V3a1 1 0 0 1 1-1h8" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`;
    copyBtn.title = 'Copy code';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(block.textContent);
      copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="5" y="5" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none" rx="1"/>
          <path d="M3 11V3a1 1 0 0 1 1-1h8" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>`;
        copyBtn.classList.remove('copied');
      }, 2000);
    });
    pre.style.position = 'relative';
    pre.appendChild(copyBtn);
  }
}

// Handle deleting a message
async function handleDeleteMessage(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  // Confirm deletion
  const confirmed = await showConfirmDialog({
    type: 'danger',
    title: 'Delete Message?',
    message: 'Are you sure you want to delete this message? You can undo this action with Ctrl+Z.',
    confirmText: 'Delete Message'
  });

  if (!confirmed) {
    return;
  }

  try {
    // Get message data before deleting for undo
    const messageData = await invoke('get_message_at_index', { messageIndex });

    // Delete the message
    await invoke('delete_message_at_index', { messageIndex });
    messageDiv.remove();
    await updateTokenCount();

    // Record undo action
    recordUndoAction({
      type: UndoActionType.MESSAGE_DELETE,
      description: 'Delete message',
      messageIndex,
      messageData
    });

    showSuccess('Message Deleted', 'The message has been deleted successfully.');
  } catch (error) {
    console.error('Failed to delete message:', error);
    showError('Delete Failed', `Failed to delete message: ${error}`);
  }
}

// Handle creating a new branch from a message
async function handleCreateBranch(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  // Prompt for branch name
  const branchName = prompt('Enter a name for the new branch:', `Branch ${Date.now()}`);
  if (!branchName || branchName.trim() === '') {
    return;
  }

  try {
    // Create branch from this message index
    const branch = await invoke('create_branch', {
      messageIndex: messageIndex + 1, // +1 because we want to branch AFTER this message
      branchName: branchName.trim()
    });

    showSuccess('Branch Created', `Created new branch: ${branch.name}`);

    // Switch to the new branch
    await handleSwitchBranch(branch.id);
  } catch (error) {
    console.error('Failed to create branch:', error);
    showError('Branch Creation Failed', `Failed to create branch: ${error}`);
  }
}

// Handle switching to a different branch
async function handleSwitchBranch(branchId) {
  try {
    // Switch the active branch
    const messages = await invoke('switch_branch', { branchId });

    // Clear current messages
    messagesContainer.innerHTML = '';

    // Reload messages from the new branch (same pattern as loadChatHistory)
    for (const msg of messages) {
      const messageDiv = await addMessage(msg.content, msg.role === 'user', false, msg.timestamp);

      // Apply pinned state
      if (msg.pinned && messageDiv) {
        messageDiv.classList.add('pinned');
        const pinBtn = messageDiv.querySelector('.message-pin-btn');
        if (pinBtn) {
          pinBtn.classList.add('active');
          pinBtn.title = 'Unpin message';
        }
      }

      // Apply hidden state
      if (msg.hidden && messageDiv) {
        messageDiv.classList.add('hidden-message');
        const hideBtn = messageDiv.querySelector('.message-hide-btn');
        if (hideBtn) {
          hideBtn.classList.add('active');
          hideBtn.title = 'Unhide message';
          hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M10 5L11.5 3.5M3.5 10.5L5 9M1 13L13 1M5.5 6C5.19 6.31 5 6.74 5 7.22C5 8.2 5.8 9 6.78 9C7.26 9 7.69 8.81 8 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>`;
        }
      }

      // Update swipe controls for assistant messages with swipe info
      if (msg.role === 'assistant' && messageDiv && msg.swipes && msg.swipes.length > 0) {
        updateSwipeControls(messageDiv, msg.current_swipe || 0, msg.swipes.length);
      }
    }

    // Update token count
    await updateTokenCount();

    // Update branch indicator
    await updateBranchIndicator();

    setStatus('Switched branch', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to switch branch:', error);
    setStatus(`Branch switch failed: ${error}`, 'error');
  }
}

// Handle toggling message pin status
async function handleTogglePin(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  try {
    const isPinned = await invoke('toggle_message_pin', { messageIndex });

    // Update visual indicator
    const pinBtn = messageDiv.querySelector('.message-pin-btn');
    if (isPinned) {
      messageDiv.classList.add('pinned');
      pinBtn.classList.add('active');
      pinBtn.title = 'Unpin message';
    } else {
      messageDiv.classList.remove('pinned');
      pinBtn.classList.remove('active');
      pinBtn.title = 'Pin message';
    }
  } catch (error) {
    console.error('Failed to toggle pin:', error);
    setStatus(`Pin toggle failed: ${error}`, 'error');
  }
}

// Handle toggling message hidden status
async function handleToggleHidden(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  try {
    const isHidden = await invoke('toggle_message_hidden', { messageIndex });

    // Update visual indicator
    const hideBtn = messageDiv.querySelector('.message-hide-btn');
    if (isHidden) {
      messageDiv.classList.add('hidden-message');
      hideBtn.classList.add('active');
      hideBtn.title = 'Unhide message';
      // Update icon to "eye-off"
      hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M10 5L11.5 3.5M3.5 10.5L5 9M1 13L13 1M5.5 6C5.19 6.31 5 6.74 5 7.22C5 8.2 5.8 9 6.78 9C7.26 9 7.69 8.81 8 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    } else {
      messageDiv.classList.remove('hidden-message');
      hideBtn.classList.remove('active');
      hideBtn.title = 'Hide message';
      // Update icon back to "eye"
      hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 7 3 3 7 3C11 3 13 7 13 7C13 7 11 11 7 11C3 11 1 7 1 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
      </svg>`;
    }

    await updateTokenCount();
  } catch (error) {
    console.error('Failed to toggle hidden:', error);
    setStatus(`Hide toggle failed: ${error}`, 'error');
  }
}

// Handle continuing an incomplete message
async function handleContinueMessage(messageDiv) {
  const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
  const messageIndex = allMessages.indexOf(messageDiv);

  if (messageIndex === -1) {
    console.error('Message not found in list');
    return;
  }

  const continueBtn = messageDiv.querySelector('.message-continue-btn');
  continueBtn.disabled = true;
  continueBtn.classList.add('loading');

  try {
    setStatus('Continuing message...', 'default');
    const continuedText = await invoke('continue_message', { messageIndex });

    // The backend appends to the message, so we just need to reload the content
    const contentDiv = messageDiv.querySelector('.message-content');
    const swipeInfo = await invoke('get_swipe_info', { messageIndex });
    renderAssistantContent(contentDiv, swipeInfo.content);

    setStatus('Message continued', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
    await updateTokenCount();
  } catch (error) {
    console.error('Failed to continue message:', error);
    setStatus(`Continue failed: ${error}`, 'error');
  } finally {
    continueBtn.disabled = false;
    continueBtn.classList.remove('loading');
  }
}

// Extract message sending logic into separate function
async function sendMessage(message, isRegenerate = false) {
  // Execute beforeMessageSend hook
  message = await executeHook('beforeMessageSend', message);

  if (!isRegenerate) {
    await addMessage(message, true, false, Date.now());
  }

  sendBtn.disabled = true;
  messageInput.disabled = true;
  setStatus('Connecting to API...', 'default');

  // Check if streaming is enabled
  let streamEnabled = false;
  try {
    const config = await invoke('get_api_config');
    streamEnabled = config.stream || false;
  } catch (error) {
    console.error('Failed to get config:', error);
  }

  if (streamEnabled) {
    // Use streaming
    setStatus('Streaming response...', 'streaming');

    let streamingMessageDiv = null;
    let streamingContentDiv = null;
    let fullContent = '';

    // Create streaming message container
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'avatar-circle';

    // Set avatar image for streaming messages
    if (currentCharacter && currentCharacter.avatar_path) {
      getAvatarUrl(currentCharacter.avatar_path).then(url => {
        if (url) {
          avatar.style.backgroundImage = `url('${url}')`;
          makeAvatarClickable(avatar, url);
        }
      });
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Create swipe wrapper for assistant messages
    const swipeWrapper = document.createElement('div');
    swipeWrapper.style.display = 'flex';
    swipeWrapper.style.flexDirection = 'column';
    swipeWrapper.appendChild(contentDiv);

    const swipeControls = createSwipeControls(messageDiv);
    swipeWrapper.appendChild(swipeControls);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(swipeWrapper);
    messagesContainer.appendChild(messageDiv);

    streamingMessageDiv = messageDiv;
    streamingContentDiv = contentDiv;

    // Set up event listeners for streaming
    const { listen } = window.__TAURI__.event;

    const tokenUnlisten = await listen('chat-token', (event) => {
      const token = event.payload;
      fullContent += token;

      // Update content with markdown rendering
      renderAssistantContent(streamingContentDiv, fullContent);

      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    const completeUnlisten = await listen('chat-complete', () => {
      // Add regenerate button after streaming completes
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';

      const regenerateBtn = document.createElement('button');
      regenerateBtn.className = 'message-action-btn';
      regenerateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 3.68629 3.68629 1 7 1C10.3137 1 13 3.68629 13 7C13 10.3137 10.3137 13 7 13C5.5 13 4.16667 12.3333 3 11.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M1 10V7H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      regenerateBtn.title = 'Regenerate response';
      regenerateBtn.addEventListener('click', () => handleRegenerateMessage(streamingMessageDiv));
      actionsDiv.appendChild(regenerateBtn);
      streamingMessageDiv.appendChild(actionsDiv);

      setStatus('Response complete', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
      tokenUnlisten();
      completeUnlisten();
    });

    try {
      await invoke('chat_stream', { message });
    } catch (error) {
      tokenUnlisten();
      completeUnlisten();
      if (streamingMessageDiv) {
        streamingMessageDiv.remove();
      }
      if (error.includes('not configured')) {
        addMessage('API not configured. Please configure your API settings.', false);
        setStatus('API not configured', 'error');
        setTimeout(showSettings, 1000);
      } else {
        addMessage(`Error: ${error}`, false);
        setStatus(`Error: ${error.substring(0, 50)}...`, 'error');
      }
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }
  } else {
    // Use non-streaming
    showTypingIndicator();

    try {
      let response = await invoke('chat', { message });

      // Execute afterMessageReceive hook
      response = await executeHook('afterMessageReceive', response);

      removeTypingIndicator();
      await addMessage(response, false);
      setStatus('Response complete', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
    } catch (error) {
      removeTypingIndicator();
      if (error.includes('not configured')) {
        addMessage('API not configured. Please configure your API settings.', false);
        setStatus('API not configured', 'error');
        setTimeout(showSettings, 1000);
      } else {
        addMessage(`Error: ${error}`, false);
        setStatus(`Error: ${error.substring(0, 50)}...`, 'error');
      }
    } finally {
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }
  }
}

// Show typing indicator
function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message assistant';
  typingDiv.id = 'typing-indicator';

  const indicatorDiv = document.createElement('div');
  indicatorDiv.className = 'typing-indicator';

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'typing-dot';
    indicatorDiv.appendChild(dot);
  }

  typingDiv.appendChild(indicatorDiv);
  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Remove typing indicator
function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

// Update status with optional styling
function setStatus(text, type = 'default') {
  statusText.textContent = text;

  // Remove all status classes
  statusText.classList.remove('streaming', 'error', 'success');

  // Add appropriate class based on type
  if (type === 'streaming') {
    statusText.classList.add('streaming');
  } else if (type === 'error') {
    statusText.classList.add('error');
  } else if (type === 'success') {
    statusText.classList.add('success');
  }
}

// Show/hide settings
async function showSettings() {
  const overlay = document.getElementById('settings-overlay');
  settingsPanel.classList.add('open');
  overlay.classList.add('show');
  await loadCharacterSettings();
}

function hideSettings() {
  const overlay = document.getElementById('settings-overlay');
  settingsPanel.classList.remove('open');
  overlay.classList.remove('show');
}

// Show/hide roleplay panel
async function showRoleplayPanel() {
  const panel = document.getElementById('roleplay-panel');
  const overlay = document.getElementById('roleplay-overlay');
  panel.classList.add('open');
  overlay.classList.add('show');

  // Load roleplay settings when panel opens
  await loadRoleplaySettings();
}

function hideRoleplayPanel() {
  const panel = document.getElementById('roleplay-panel');
  const overlay = document.getElementById('roleplay-overlay');
  panel.classList.remove('open');
  overlay.classList.remove('show');
}

// Tab switching
function setupTabs() {
  // Settings tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Remove active class from all tabs and contents
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      // Add active class to clicked tab and corresponding content
      btn.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');

      // Load plugins list when plugins tab is opened
      if (targetTab === 'plugins') {
        loadPluginsList();
      }
    });
  });

  // Roleplay tabs
  const roleplayTabBtns = document.querySelectorAll('.roleplay-tab-btn');
  const roleplayTabContents = document.querySelectorAll('.roleplay-tab-content');

  roleplayTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Remove active class from all roleplay tabs and contents
      roleplayTabBtns.forEach(b => b.classList.remove('active'));
      roleplayTabContents.forEach(c => c.classList.remove('active'));

      // Add active class to clicked tab and corresponding content
      btn.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');
    });
  });
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  messageInput.value = '';
  autoResize(messageInput);

  // Clear the auto-saved draft since message is being sent
  clearAutoSavedDraft();

  // Check if we're in a group chat
  if (currentGroupChat) {
    await sendGroupMessage(message);
  } else {
    await sendMessage(message);
  }
}

// Settings functionality
async function handleValidate() {
  const baseUrl = document.getElementById('api-base-url').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const validateBtn = document.getElementById('validate-btn');
  const modelsGroup = document.getElementById('models-group');
  const modelSelect = document.getElementById('model-select');
  const saveBtn = document.getElementById('save-settings-btn');
  const validationMsg = document.getElementById('validation-message');

  if (!baseUrl || !apiKey) {
    validationMsg.textContent = 'Please fill in all fields';
    validationMsg.className = 'validation-message error';
    return;
  }

  validateBtn.disabled = true;
  validateBtn.classList.add('loading');
  validateBtn.textContent = 'Validating...';
  validationMsg.style.display = 'none';
  setStatus('Validating API...', 'default');

  try {
    const models = await invoke('validate_api', { baseUrl, apiKey });

    validationMsg.textContent = `Found ${models.length} models`;
    validationMsg.className = 'validation-message success';
    setStatus('API validated successfully', 'success');
    setTimeout(() => setStatus('Ready'), 2000);

    modelSelect.innerHTML = '<option value="">Select a model</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });

    modelsGroup.style.display = 'flex';
    modelsGroup.classList.add('fade-in');
    saveBtn.disabled = false;
  } catch (error) {
    validationMsg.textContent = `Validation failed: ${error}`;
    validationMsg.className = 'validation-message error';
    setStatus('API validation failed', 'error');
    modelsGroup.style.display = 'none';
    saveBtn.disabled = true;
  } finally {
    validateBtn.disabled = false;
    validateBtn.classList.remove('loading');
    validateBtn.textContent = 'Validate';
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();

  const baseUrl = document.getElementById('api-base-url').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-select').value;
  const stream = document.getElementById('stream-toggle').checked;
  const contextLimit = parseInt(document.getElementById('context-limit').value) || 200000;
  const saveBtn = document.getElementById('save-settings-btn');
  const validationMsg = document.getElementById('validation-message');

  if (!model) {
    validationMsg.textContent = 'Please select a model';
    validationMsg.className = 'validation-message error';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.classList.add('loading');
  saveBtn.textContent = 'Saving...';
  setStatus('Saving configuration...', 'default');

  try {
    await invoke('save_api_config', { baseUrl, apiKey, model, stream, contextLimit });

    // Update cached context limit
    cachedContextLimit = contextLimit;

    validationMsg.textContent = 'Configuration saved successfully';
    validationMsg.className = 'validation-message success';
    setStatus('Configuration saved', 'success');

    setTimeout(() => {
      hideSettings();
      messagesContainer.innerHTML = '';
      addMessage('API configured. Ready to chat.', false, true);
      setStatus('Ready');
    }, 1000);
  } catch (error) {
    validationMsg.textContent = `Failed to save: ${error}`;
    validationMsg.className = 'validation-message error';
    setStatus('Failed to save configuration', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove('loading');
    saveBtn.textContent = 'Save Configuration';
  }
}

// Avatar upload handling
async function handleAvatarUpload() {
  const characterMsg = document.getElementById('character-message');

  try {
    const characterId = document.getElementById('character-settings-select').value;
    const avatarFilename = await invoke('select_and_upload_avatar', {
      characterId: characterId
    });

    pendingAvatarPath = avatarFilename;

    // Update preview
    const avatarPreview = document.querySelector('.avatar-circle-large');
    const avatarUrl = await getAvatarUrl(avatarFilename);
    if (avatarUrl) {
      avatarPreview.style.backgroundImage = `url('${avatarUrl}')`;
    }
    document.getElementById('remove-avatar-btn').style.display = 'inline-block';

    characterMsg.textContent = 'Avatar uploaded. Click "Save Character" to apply.';
    characterMsg.className = 'validation-message success';
    setTimeout(() => {
      characterMsg.style.display = 'none';
    }, 3000);
  } catch (error) {
    console.error('Avatar upload error:', error);
    // Don't show error if user just cancelled the dialog
    if (error && !error.toString().includes('No file selected')) {
      characterMsg.textContent = `Failed to upload avatar: ${error}`;
      characterMsg.className = 'validation-message error';
    }
  }
}

// Make avatar circle clickable for uploading
function makeAvatarUploadable(avatarCircle, uploadHandler) {
  if (!avatarCircle) return;

  // Make clickable
  avatarCircle.style.cursor = 'pointer';
  avatarCircle.title = 'Click to upload avatar or drag & drop an image';

  avatarCircle.addEventListener('click', (e) => {
    e.stopPropagation();
    // Only trigger upload if no avatar is set (empty background)
    const hasAvatar = avatarCircle.style.backgroundImage && avatarCircle.style.backgroundImage !== '';
    if (!hasAvatar) {
      uploadHandler();
    } else {
      // If avatar exists, show the full-size view (existing behavior)
      // This will be handled by makeAvatarClickable which is called separately
    }
  });

  // Add drag-drop support
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    avatarCircle.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  avatarCircle.addEventListener('dragenter', () => {
    avatarCircle.style.transform = 'scale(1.05)';
    avatarCircle.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.5)';
  });

  avatarCircle.addEventListener('dragleave', () => {
    avatarCircle.style.transform = '';
    avatarCircle.style.boxShadow = '';
  });

  avatarCircle.addEventListener('drop', async (e) => {
    avatarCircle.style.transform = '';
    avatarCircle.style.boxShadow = '';

    // For Tauri apps, trigger the file dialog instead of direct file access
    // Direct file path access from drag-drop is restricted for security
    uploadHandler();
  });
}

function handleAvatarRemove() {
  pendingAvatarPath = null;
  const avatarPreview = document.querySelector('.avatar-circle-large');
  avatarPreview.style.backgroundImage = '';
  document.getElementById('remove-avatar-btn').style.display = 'none';

  const characterMsg = document.getElementById('character-message');
  characterMsg.textContent = 'Avatar removed. Click "Save Character" to apply.';
  characterMsg.className = 'validation-message success';
  setTimeout(() => {
    characterMsg.style.display = 'none';
  }, 3000);
}

// App controls
function setupAppControls() {
  document.getElementById('settings-btn').addEventListener('click', showSettings);
  document.getElementById('close-settings-btn').addEventListener('click', hideSettings);
  document.getElementById('settings-overlay').addEventListener('click', hideSettings);
  document.getElementById('roleplay-btn').addEventListener('click', showRoleplayPanel);
  document.getElementById('close-roleplay-btn').addEventListener('click', hideRoleplayPanel);
  document.getElementById('roleplay-overlay').addEventListener('click', hideRoleplayPanel);
  document.getElementById('clear-btn').addEventListener('click', clearHistory);
  document.getElementById('export-chat-btn').addEventListener('click', exportChatHistory);
  document.getElementById('import-chat-btn').addEventListener('click', importChatHistory);

  // VN mode toggle handler
  const vnToggleBtn = document.getElementById('toggle-vn-mode-btn');
  if (vnToggleBtn) {
    vnToggleBtn.addEventListener('click', async () => {
      const currentMode = localStorage.getItem('claudia-view-mode') || 'cozy';
      const isVNMode = currentMode === 'visual-novel';

      // Toggle between VN mode and the previous non-VN mode
      const previousMode = localStorage.getItem('claudia-previous-view-mode') || 'cozy';
      const newMode = isVNMode ? previousMode : 'visual-novel';

      // Save the current mode as previous if we're switching to VN
      if (!isVNMode) {
        localStorage.setItem('claudia-previous-view-mode', currentMode);
      }

      await applyViewMode(newMode);

      // Update the view mode select in settings if it exists
      const viewModeSelect = document.getElementById('view-mode-select');
      if (viewModeSelect) {
        viewModeSelect.value = newMode;
      }

      // Update button state
      vnToggleBtn.setAttribute('aria-pressed', newMode === 'visual-novel');
      if (newMode === 'visual-novel') {
        vnToggleBtn.classList.add('active');
      } else {
        vnToggleBtn.classList.remove('active');
      }
    });

    // Initialize button state based on current mode
    const currentMode = localStorage.getItem('claudia-view-mode') || 'cozy';
    vnToggleBtn.setAttribute('aria-pressed', currentMode === 'visual-novel');
    if (currentMode === 'visual-novel') {
      vnToggleBtn.classList.add('active');
    }
  }

  // Export modal handlers
  document.getElementById('export-close-btn').addEventListener('click', hideExportModal);
  document.querySelector('#export-modal .export-overlay').addEventListener('click', hideExportModal);

  // Export format buttons
  document.querySelectorAll('.export-option-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const format = e.currentTarget.dataset.format;
      switch (format) {
        case 'json':
          await exportAsJSON();
          break;
        case 'html':
          await exportAsHTML();
          break;
        case 'markdown':
          await exportAsMarkdown();
          break;
        case 'text':
          await exportAsText();
          break;
        case 'pdf':
          await exportAsPDF();
          break;
        case 'clipboard':
          await copyToClipboard();
          break;
      }
    });
  });

  characterSelect.addEventListener('change', handleCharacterSwitch);
  newCharacterBtn.addEventListener('click', handleNewCharacter);
  document.getElementById('delete-character-btn').addEventListener('click', handleDeleteCharacter);
  document.getElementById('character-settings-select').addEventListener('change', async () => {
    const characterId = document.getElementById('character-settings-select').value;
    await invoke('set_active_character', { characterId });
    await loadCharacterSettings();
  });
  document.getElementById('upload-avatar-btn').addEventListener('click', handleAvatarUpload);
  document.getElementById('remove-avatar-btn').addEventListener('click', handleAvatarRemove);
  document.getElementById('import-character-btn').addEventListener('click', handleImportCharacter);
  document.getElementById('export-character-btn').addEventListener('click', handleExportCharacter);
  document.getElementById('upload-expression-btn').addEventListener('click', handleUploadExpression);
  document.getElementById('default-expression-select').addEventListener('change', handleDefaultExpressionChange);

  // Setup collapsible sections
  document.querySelectorAll('.settings-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.parentElement;
      section.classList.toggle('collapsed');
    });
  });

  // Setup theme selector
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      applyTheme(e.target.value);
    });
  }

  // Setup view mode selector
  const viewModeSelect = document.getElementById('view-mode-select');
  if (viewModeSelect) {
    viewModeSelect.addEventListener('change', async (e) => {
      await applyViewMode(e.target.value);
    });
  }

  // Setup font size slider
  const fontSizeSlider = document.getElementById('font-size-slider');
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', (e) => {
      applyFontSize(parseInt(e.target.value));
    });
  }

  // Setup layout mode selector
  const layoutModeSelect = document.getElementById('layout-mode-select');
  if (layoutModeSelect) {
    layoutModeSelect.addEventListener('change', (e) => {
      applyLayoutMode(e.target.value);
    });
  }

  // Setup timestamp toggle
  const timestampToggle = document.getElementById('show-timestamps-toggle');
  if (timestampToggle) {
    timestampToggle.addEventListener('change', (e) => {
      toggleTimestamps(e.target.checked);
    });
  }

  // Setup roleplay panel buttons
  const addWorldInfoBtn = document.getElementById('add-worldinfo-btn');
  if (addWorldInfoBtn) {
    addWorldInfoBtn.addEventListener('click', handleAddWorldInfoEntry);
    console.log('Add world info button listener attached');
  } else {
    console.error('add-worldinfo-btn not found');
  }

  const importWorldInfoBtn = document.getElementById('import-worldinfo-btn');
  if (importWorldInfoBtn) {
    importWorldInfoBtn.addEventListener('click', handleImportWorldInfo);
    console.log('Import world info button listener attached');
  } else {
    console.error('import-worldinfo-btn not found');
  }

  const exportWorldInfoBtn = document.getElementById('export-worldinfo-btn');
  if (exportWorldInfoBtn) {
    exportWorldInfoBtn.addEventListener('click', handleExportWorldInfo);
    console.log('Export world info button listener attached');
  } else {
    console.error('export-worldinfo-btn not found');
  }

  document.getElementById('save-authors-note-btn').addEventListener('click', handleSaveAuthorsNote);
  document.getElementById('save-persona-btn').addEventListener('click', handleSavePersona);

  // Setup prompt preview button
  document.getElementById('refresh-prompt-preview-btn').addEventListener('click', refreshPromptPreview);

  // Setup recursion depth change handler
  document.getElementById('recursion-depth').addEventListener('change', handleRecursionDepthChange);

  // Setup preset controls
  document.getElementById('preset-select').addEventListener('change', (e) => {
    handlePresetSelect(e.target.value);
  });
  document.getElementById('apply-preset-btn').addEventListener('click', handleApplyPreset);
  document.getElementById('create-preset-btn').addEventListener('click', handleCreatePreset);
  document.getElementById('add-instruction-btn').addEventListener('click', addInstructionBlock);
  document.getElementById('save-preset-changes-btn').addEventListener('click', savePresetChanges);
  document.getElementById('delete-preset-btn').addEventListener('click', deletePreset);
  document.getElementById('duplicate-preset-btn').addEventListener('click', duplicatePreset);
  document.getElementById('restore-preset-btn').addEventListener('click', restoreBuiltinPreset);

  // Setup plugin controls
  const installPluginBtn = document.getElementById('install-plugin-btn');
  if (installPluginBtn) {
    installPluginBtn.addEventListener('click', handleInstallPlugin);
  }

  // Setup sidebar controls (spacious layout)
  const sidebarNewCharBtn = document.getElementById('sidebar-new-character-btn');
  if (sidebarNewCharBtn) {
    sidebarNewCharBtn.addEventListener('click', handleNewCharacter);
  }

  const sidebarImportCharBtn = document.getElementById('sidebar-import-character-btn');
  if (sidebarImportCharBtn) {
    sidebarImportCharBtn.addEventListener('click', handleImportCharacter);
  }

  const sidebarSearch = document.getElementById('sidebar-character-search');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const items = document.querySelectorAll('.sidebar-character-item');
      items.forEach(item => {
        const name = item.querySelector('.sidebar-character-name').textContent.toLowerCase();
        if (name.includes(searchTerm)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }

  // Setup sidebar sort
  const sidebarSort = document.getElementById('sidebar-character-sort');
  if (sidebarSort) {
    // Load saved sort preference
    const savedSort = localStorage.getItem('sidebar-character-sort') || 'name-asc';
    sidebarSort.value = savedSort;

    sidebarSort.addEventListener('change', (e) => {
      localStorage.setItem('sidebar-character-sort', e.target.value);
      populateSidebarCharacterList(allCharacters);
    });
  }

  // Setup right sidebar collapse toggle
  const toggleRightSidebar = document.getElementById('toggle-right-sidebar');
  if (toggleRightSidebar) {
    toggleRightSidebar.addEventListener('click', () => {
      const rightSidebar = document.querySelector('.right-sidebar');
      const appContainer = document.querySelector('.app-container');
      if (rightSidebar && appContainer) {
        const isCollapsed = rightSidebar.classList.toggle('collapsed');
        appContainer.classList.toggle('right-sidebar-collapsed');

        // Update aria-expanded and aria-label
        toggleRightSidebar.setAttribute('aria-expanded', !isCollapsed);
        toggleRightSidebar.setAttribute('aria-label', isCollapsed ? 'Expand roleplay tools sidebar' : 'Collapse roleplay tools sidebar');

        // Update title
        toggleRightSidebar.setAttribute('title', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');

        // Flip arrow icon: ◄ when expanded (collapse left), ► when collapsed (expand right)
        const svg = toggleRightSidebar.querySelector('path');
        if (svg) {
          svg.setAttribute('d', isCollapsed ? 'M6 4L10 8L6 12' : 'M10 4L6 8L10 12');
        }

        // Save preference
        localStorage.setItem('right-sidebar-collapsed', isCollapsed);
      }
    });

    // Restore saved state
    const savedRightCollapsed = localStorage.getItem('right-sidebar-collapsed') === 'true';
    if (savedRightCollapsed) {
      toggleRightSidebar.click();
    }
  }

  // Left sidebar toggle
  const toggleLeftSidebar = document.getElementById('toggle-left-sidebar');
  if (toggleLeftSidebar) {
    toggleLeftSidebar.addEventListener('click', () => {
      const leftSidebar = document.querySelector('.left-sidebar');
      const appContainer = document.querySelector('.app-container');
      if (leftSidebar && appContainer) {
        const isCollapsed = leftSidebar.classList.toggle('collapsed');
        appContainer.classList.toggle('left-sidebar-collapsed');

        // Update aria-expanded and aria-label
        toggleLeftSidebar.setAttribute('aria-expanded', !isCollapsed);
        toggleLeftSidebar.setAttribute('aria-label', isCollapsed ? 'Expand character sidebar' : 'Collapse character sidebar');

        // Update title
        toggleLeftSidebar.setAttribute('title', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');

        // Flip arrow icon: ► when expanded (collapse right), ◄ when collapsed (expand left)
        const svg = toggleLeftSidebar.querySelector('path');
        if (svg) {
          svg.setAttribute('d', isCollapsed ? 'M10 4L6 8L10 12' : 'M6 4L10 8L6 12');
        }

        // Save preference
        localStorage.setItem('left-sidebar-collapsed', isCollapsed);
      }
    });

    // Restore saved state
    const savedLeftCollapsed = localStorage.getItem('left-sidebar-collapsed') === 'true';
    if (savedLeftCollapsed) {
      toggleLeftSidebar.click();
    }
  }
}

// Plugin Management
async function handleInstallPlugin() {
  const urlInput = document.getElementById('plugin-url-input');
  const repoUrl = urlInput.value.trim();

  if (!repoUrl) {
    await window.__TAURI__.dialog.message('Please enter a GitHub repository URL', { title: 'Plugin Installation', kind: 'error' });
    return;
  }

  try {
    await invoke('install_plugin', { repoUrl });
    await window.__TAURI__.dialog.message('Plugin installed successfully! Enable it in the plugins list below.', { title: 'Success', kind: 'info' });
    urlInput.value = '';
    await loadPluginsList();
  } catch (error) {
    await window.__TAURI__.dialog.message(`Failed to install plugin: ${error}`, { title: 'Installation Failed', kind: 'error' });
    console.error('Plugin installation error:', error);
  }
}

async function loadPluginsList() {
  const pluginsList = document.getElementById('plugins-list');
  if (!pluginsList) return;

  try {
    const plugins = await invoke('list_plugins');

    if (plugins.length === 0) {
      pluginsList.innerHTML = '<div style="color: var(--text-secondary); padding: 12px; text-align: center;">No plugins installed</div>';
      return;
    }

    pluginsList.innerHTML = plugins.map(plugin => `
      <div class="plugin-card" style="
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary);">${plugin.manifest.name}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
              v${plugin.manifest.version} by ${plugin.manifest.author}
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input
                type="checkbox"
                ${plugin.enabled ? 'checked' : ''}
                onchange="handleTogglePlugin('${plugin.manifest.id}', this.checked)"
              />
              <span style="font-size: 12px; color: var(--text-secondary);">Enabled</span>
            </label>
          </div>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
          ${plugin.manifest.description}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button
            onclick="handleConfigurePlugin('${plugin.manifest.id}')"
            class="btn-secondary"
            style="font-size: 11px; padding: 4px 8px;"
          >
            Configure
          </button>
          <button
            onclick="handleUpdatePlugin('${plugin.manifest.id}')"
            class="btn-secondary"
            style="font-size: 11px; padding: 4px 8px;"
          >
            Update
          </button>
          <button
            onclick="handleUninstallPlugin('${plugin.manifest.id}')"
            class="btn-secondary"
            style="font-size: 11px; padding: 4px 8px; color: var(--error-color);"
          >
            Uninstall
          </button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load plugins:', error);
    pluginsList.innerHTML = '<div style="color: var(--error-color); padding: 12px;">Failed to load plugins</div>';
  }
}

async function handleTogglePlugin(pluginId, enabled) {
  try {
    if (enabled) {
      await invoke('enable_plugin', { pluginId });
      await window.__TAURI__.dialog.message('Plugin enabled! Please reload the app for changes to take effect.', { title: 'Plugin Enabled', kind: 'info' });
    } else {
      await invoke('disable_plugin', { pluginId });
      await window.__TAURI__.dialog.message('Plugin disabled! Please reload the app for changes to take effect.', { title: 'Plugin Disabled', kind: 'info' });
    }
    await loadPluginsList();
  } catch (error) {
    await window.__TAURI__.dialog.message(`Failed to ${enabled ? 'enable' : 'disable'} plugin: ${error}`, { title: 'Error', kind: 'error' });
    console.error('Plugin toggle error:', error);
    await loadPluginsList();
  }
}

async function handleUpdatePlugin(pluginId) {
  try {
    await invoke('update_plugin', { pluginId });
    await window.__TAURI__.dialog.message('Plugin updated successfully! Please reload the app for changes to take effect.', { title: 'Success', kind: 'info' });
    await loadPluginsList();
  } catch (error) {
    await window.__TAURI__.dialog.message(`Failed to update plugin: ${error}`, { title: 'Update Failed', kind: 'error' });
    console.error('Plugin update error:', error);
  }
}

async function handleConfigurePlugin(pluginId) {
  // Check if plugin has registered settings UI
  const settingsCallback = pluginSettingsRegistry[pluginId];

  if (!settingsCallback) {
    showInfo('Plugin Settings', 'No configuration available for this plugin');
    return;
  }

  // Call the plugin's settings callback to open its settings UI
  try {
    await settingsCallback();
  } catch (error) {
    console.error(`Failed to open settings for plugin ${pluginId}:`, error);
    showError('Plugin Settings', 'Failed to open plugin settings');
  }
}

// Make it globally accessible for onclick handlers
window.handleConfigurePlugin = handleConfigurePlugin;

async function handleUninstallPlugin(pluginId) {
  const confirmed = await window.__TAURI__.dialog.confirm('Are you sure you want to uninstall this plugin? This cannot be undone.', { title: 'Confirm Uninstall', kind: 'warning' });

  if (!confirmed) return;

  try {
    await invoke('uninstall_plugin', { pluginId });
    await window.__TAURI__.dialog.message('Plugin uninstalled successfully!', { title: 'Success', kind: 'info' });
    await loadPluginsList();
  } catch (error) {
    await window.__TAURI__.dialog.message(`Failed to uninstall plugin: ${error}`, { title: 'Uninstall Failed', kind: 'error' });
    console.error('Plugin uninstall error:', error);
  }
}

// Make plugin functions globally accessible for onclick handlers
window.handleTogglePlugin = handleTogglePlugin;
window.handleUpdatePlugin = handleUpdatePlugin;
window.handleUninstallPlugin = handleUninstallPlugin;

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  messageInput.addEventListener('keydown', (e) => {
    // Handle mention autocomplete navigation
    if (mentionAutocompleteVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateMentionAutocomplete('down');
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateMentionAutocomplete('up');
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectCurrentMention();
        return;
      } else if (e.key === 'Escape') {
        hideMentionAutocomplete();
        return;
      }
    }

    // Regular enter key handling
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  });

  messageInput.addEventListener('input', () => {
    autoResize(messageInput);
    updateTokenCount();
    handleMentionInput(); // Check for @ mentions
  });
}

// Token Counter
let tokenUpdateTimeout = null;

// Helper function to format token counts
function formatTokenCount(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k';
  }
  return count.toString();
}

async function updateTokenCount() {
  // Debounce token count updates
  if (tokenUpdateTimeout) {
    clearTimeout(tokenUpdateTimeout);
  }

  tokenUpdateTimeout = setTimeout(async () => {
    try {
      const currentInput = messageInput.value;
      const tokenData = await invoke('get_token_count', {
        characterId: null, // Use active character
        currentInput
      });

      // Update total display (use cached context limit)
      const tokenCounter = document.getElementById('token-counter');
      const tokenCountTotal = document.getElementById('token-count-total');

      // Format: "2.5k / 200k tokens"
      tokenCountTotal.textContent = `${formatTokenCount(tokenData.total)} / ${formatTokenCount(cachedContextLimit)} tokens`;

      // Update breakdown
      document.getElementById('token-system').textContent = tokenData.system_prompt;
      document.getElementById('token-preset').textContent = tokenData.preset_instructions;
      document.getElementById('token-persona').textContent = tokenData.persona;
      document.getElementById('token-worldinfo').textContent = tokenData.world_info;
      document.getElementById('token-authorsnote').textContent = tokenData.authors_note;
      document.getElementById('token-examples').textContent = tokenData.message_examples;
      document.getElementById('token-history').textContent = tokenData.message_history;
      document.getElementById('token-input').textContent = tokenData.current_input;
      document.getElementById('token-total-detail').textContent = tokenData.total;
    } catch (error) {
      console.error('Failed to update token count:', error);
      // Keep counter visible, just show 0
      const tokenCountTotal = document.getElementById('token-count-total');
      tokenCountTotal.textContent = '0 / 200k tokens';
    }
  }, 300); // Update after 300ms of no typing
}

// Toggle token breakdown display
document.getElementById('token-details-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const breakdown = document.getElementById('token-breakdown');
  breakdown.style.display = breakdown.style.display === 'none' ? 'block' : 'none';
});

// Close breakdown when clicking outside
document.addEventListener('click', (e) => {
  const breakdown = document.getElementById('token-breakdown');
  const detailsBtn = document.getElementById('token-details-btn');

  if (!breakdown.contains(e.target) && !detailsBtn.contains(e.target)) {
    breakdown.style.display = 'none';
  }
});

// Update branch indicator in header
async function updateBranchIndicator() {
  try {
    const branchId = await invoke('get_active_branch_id');
    const branches = await invoke('list_branches');
    const activeBranch = branches.find(b => b.id === branchId);

    const featureBadges = document.getElementById('feature-badges');

    // Remove existing branch badge
    const existingBadge = featureBadges.querySelector('.branch-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    // Add new branch badge if not on main
    if (activeBranch && activeBranch.id !== 'main') {
      const branchBadge = document.createElement('div');
      branchBadge.className = 'branch-badge';
      branchBadge.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M2 2V12M2 2C2.82843 2 3.5 2.67157 3.5 3.5C3.5 4.32843 2.82843 5 2 5M2 2C1.17157 2 0.5 2.67157 0.5 3.5C0.5 4.32843 1.17157 5 2 5M2 5V7M2 7C2 9 3 10 5 10H10.5M2 7V12M10.5 10C10.5 10.8284 11.1716 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.1716 8.5 10.5 9.17157 10.5 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>${activeBranch.name}</span>
      `;
      branchBadge.title = `Branch: ${activeBranch.name} (click to manage branches)`;
      branchBadge.style.cursor = 'pointer';
      branchBadge.addEventListener('click', openBranchManager);
      featureBadges.appendChild(branchBadge);
    }
  } catch (error) {
    console.error('Failed to update branch indicator:', error);
  }
}

// Open branch manager modal
async function openBranchManager() {
  try {
    const branches = await invoke('list_branches');
    const activeBranchId = await invoke('get_active_branch_id');

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'branch-manager-modal';
    modal.innerHTML = `
      <div class="branch-manager-overlay"></div>
      <div class="branch-manager-content">
        <div class="branch-manager-header">
          <h3>Branch Manager</h3>
          <button class="icon-btn" id="close-branch-manager">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="branch-list">
          ${branches.map(branch => `
            <div class="branch-item ${branch.id === activeBranchId ? 'active' : ''}" data-branch-id="${branch.id}">
              <div class="branch-info">
                <div class="branch-name">${branch.name}</div>
                <div class="branch-meta">${new Date(branch.created_at).toLocaleString()}</div>
              </div>
              <div class="branch-actions">
                ${branch.id === activeBranchId ? '<span class="branch-active-label">Active</span>' : `<button class="btn-secondary branch-switch-btn" data-branch-id="${branch.id}">Switch</button>`}
                ${branch.id !== 'main' ? `<button class="btn-secondary branch-rename-btn" data-branch-id="${branch.id}">Rename</button>` : ''}
                ${branch.id !== 'main' && branch.id !== activeBranchId ? `<button class="btn-danger branch-delete-btn" data-branch-id="${branch.id}">Delete</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Add event listeners
    modal.querySelector('#close-branch-manager').addEventListener('click', () => modal.remove());
    modal.querySelector('.branch-manager-overlay').addEventListener('click', () => modal.remove());

    modal.querySelectorAll('.branch-switch-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const branchId = e.target.dataset.branchId;
        modal.remove();
        await handleSwitchBranch(branchId);
      });
    });

    modal.querySelectorAll('.branch-rename-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const branchId = e.target.dataset.branchId;
        const branch = branches.find(b => b.id === branchId);
        const newName = prompt('Enter new branch name:', branch.name);
        if (newName && newName.trim() !== '') {
          try {
            await invoke('rename_branch', { branchId, newName: newName.trim() });
            modal.remove();
            await updateBranchIndicator();
            setStatus('Branch renamed', 'success');
          } catch (error) {
            setStatus(`Rename failed: ${error}`, 'error');
          }
        }
      });
    });

    modal.querySelectorAll('.branch-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const branchId = e.target.dataset.branchId;
        const branch = branches.find(b => b.id === branchId);

        const confirmed = await showConfirmDialog({
          type: 'danger',
          title: 'Delete Branch?',
          message: `Are you sure you want to delete the branch "${branch.name}"? All messages in this branch will be permanently lost. This action cannot be undone.`,
          confirmText: 'Delete Branch'
        });

        if (confirmed) {
          try {
            await invoke('delete_branch', { branchId });
            modal.remove();
            await updateBranchIndicator();
            showSuccess('Branch Deleted', `Branch "${branch.name}" has been deleted.`);
          } catch (error) {
            showError('Delete Failed', `Failed to delete branch: ${error}`);
          }
        }
      });
    });
  } catch (error) {
    console.error('Failed to open branch manager:', error);
    setStatus(`Failed to open branch manager: ${error}`, 'error');
  }
}

// Character filter and sort state
let allCharacters = [];
let allGroupChats = [];
let charactersMap = {}; // Map of character ID to character object
let characterFilterText = '';
let characterSortOrder = 'name-asc';

// Filter and sort characters
function filterAndSortCharacters(characters) {
  let filtered = characters;

  // Apply filter
  if (characterFilterText) {
    const searchTerm = characterFilterText.toLowerCase();
    filtered = characters.filter(char =>
      char.name.toLowerCase().includes(searchTerm)
    );
  }

  // Apply sort
  const sorted = [...filtered];
  switch (characterSortOrder) {
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'date-asc':
      sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      break;
    case 'date-desc':
      sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      break;
  }

  return sorted;
}

// Populate character dropdown
function populateCharacterDropdown(characters, groupChats = []) {
  const filtered = filterAndSortCharacters(characters);
  characterSelect.innerHTML = '';

  // Add characters
  if (filtered.length > 0) {
    const charactersGroup = document.createElement('optgroup');
    charactersGroup.label = 'Characters';
    filtered.forEach(char => {
      const option = document.createElement('option');
      option.value = char.id;
      option.textContent = char.name;
      option.dataset.type = 'character';
      charactersGroup.appendChild(option);
    });
    characterSelect.appendChild(charactersGroup);
  }

  // Add group chats
  if (groupChats.length > 0) {
    const groupsGroup = document.createElement('optgroup');
    groupsGroup.label = 'Group Chats';
    groupChats.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = `👥 ${group.name} (${group.character_ids.length})`;
      option.dataset.type = 'group';
      groupsGroup.appendChild(option);
    });
    characterSelect.appendChild(groupsGroup);
  }
}

// Populate sidebar character list (for spacious layout)
function populateSidebarCharacterList(characters, groupChats = []) {
  const sidebarList = document.getElementById('sidebar-character-list');
  if (!sidebarList) return;

  // Use sidebar-specific sort setting
  const sortSelect = document.getElementById('sidebar-character-sort');
  const sortValue = sortSelect ? sortSelect.value : (localStorage.getItem('sidebar-character-sort') || 'name-asc');

  let sorted = [...characters];

  switch (sortValue) {
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'date-desc':
      sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      break;
    case 'date-asc':
      sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      break;
  }

  sidebarList.innerHTML = '';

  sorted.forEach(char => {
    const item = document.createElement('div');
    item.className = 'sidebar-character-item';
    item.dataset.characterId = char.id;

    if (currentCharacter && currentCharacter.id === char.id) {
      item.classList.add('active');
    }

    const avatar = document.createElement('div');
    avatar.className = 'sidebar-character-avatar';

    if (char.avatar) {
      const img = document.createElement('img');
      img.src = char.avatar;
      img.alt = char.name;
      avatar.appendChild(img);
    } else {
      avatar.textContent = char.name.charAt(0).toUpperCase();
    }

    const info = document.createElement('div');
    info.className = 'sidebar-character-info';

    const name = document.createElement('div');
    name.className = 'sidebar-character-name';
    name.textContent = char.name;

    info.appendChild(name);
    item.appendChild(avatar);
    item.appendChild(info);

    // Add three-dot menu
    const menuBtn = document.createElement('button');
    menuBtn.className = 'character-menu-btn';
    menuBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
      </svg>
    `;
    menuBtn.title = 'Character options';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCharacterMenu(char, menuBtn);
    });
    item.appendChild(menuBtn);

    // Handle character selection - show chat list
    item.addEventListener('click', async () => {
      updateActiveCharacterInSidebar(char.id);
      await showBranchListForCharacter(char);
    });

    sidebarList.appendChild(item);
  });

  // Add group chats section
  if (groupChats && groupChats.length > 0) {
    // Add separator
    const separator = document.createElement('div');
    separator.className = 'sidebar-separator';
    separator.innerHTML = '<span>Group Chats</span>';
    sidebarList.appendChild(separator);

    groupChats.forEach(group => {
      const item = document.createElement('div');
      item.className = 'sidebar-character-item group-chat-item';
      item.dataset.groupId = group.id;

      const avatar = document.createElement('div');
      avatar.className = 'sidebar-character-avatar group-avatar';
      avatar.innerHTML = '👥';

      const info = document.createElement('div');
      info.className = 'sidebar-character-info';

      const name = document.createElement('div');
      name.className = 'sidebar-character-name';
      name.textContent = group.name;

      const memberCount = document.createElement('div');
      memberCount.className = 'sidebar-character-desc';
      memberCount.textContent = `${group.character_ids.length} members`;

      info.appendChild(name);
      info.appendChild(memberCount);
      item.appendChild(avatar);
      item.appendChild(info);

      // Handle group chat selection
      item.addEventListener('click', async () => {
        characterSelect.value = group.id;
        await handleCharacterSwitch();
      });

      sidebarList.appendChild(item);
    });
  }
}

// Update active character in sidebar
function updateActiveCharacterInSidebar(characterId) {
  const items = document.querySelectorAll('.sidebar-character-item');
  items.forEach(item => {
    if (item.dataset.characterId === characterId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Show character menu dropdown
function showCharacterMenu(character, buttonEl) {
  // Close any existing menus
  document.querySelectorAll('.character-menu-dropdown').forEach(m => m.remove());

  // Create dropdown
  const menu = document.createElement('div');
  menu.className = 'character-menu-dropdown show';

  menu.innerHTML = `
    <div class="character-menu-item" data-action="edit">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M10.5 1.5L12.5 3.5L4.5 11.5L1.5 12.5L2.5 9.5L10.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Edit Character
    </div>
    <div class="character-menu-item" data-action="duplicate">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="3" y="3" width="8" height="8" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M5 3V1.5C5 1.22 5.22 1 5.5 1H12.5C12.78 1 13 1.22 13 1.5V8.5C13 8.78 12.78 9 12.5 9H11" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      Duplicate Character
    </div>
    <div class="character-menu-item" data-action="export">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1V9M7 1L4 4M7 1L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M1 9V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Export Character
    </div>
    <div class="character-menu-item danger" data-action="delete">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4H12M5 4V2H9V4M3 4L4 12H10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Delete Character
    </div>
  `;

  // Position menu relative to button
  const buttonRect = buttonEl.getBoundingClientRect();
  const parent = buttonEl.parentElement;
  const parentRect = parent.getBoundingClientRect();

  menu.style.position = 'absolute';
  menu.style.top = `${buttonRect.bottom - parentRect.top + 4}px`;
  menu.style.right = `${parentRect.right - buttonRect.right}px`;

  // Add click handlers
  menu.querySelectorAll('.character-menu-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      menu.remove();

      switch (action) {
        case 'edit':
          await handleEditCharacterFromSidebar(character);
          break;
        case 'duplicate':
          await handleDuplicateCharacter(character);
          break;
        case 'export':
          await handleExportCharacterFromSidebar(character);
          break;
        case 'delete':
          await handleDeleteCharacterFromSidebar(character);
          break;
      }
    });
  });

  parent.style.position = 'relative';
  parent.appendChild(menu);

  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== buttonEl) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

// Handle edit character from sidebar
async function handleEditCharacterFromSidebar(character) {
  const modal = document.getElementById('edit-character-modal');
  const form = document.getElementById('edit-character-form');

  // Load character data into form
  document.getElementById('edit-character-id').value = character.id;
  document.getElementById('edit-character-name').value = character.name;
  document.getElementById('edit-character-system-prompt').value = character.system_prompt;
  document.getElementById('edit-character-greeting').value = character.greeting || '';
  document.getElementById('edit-character-personality').value = character.personality || '';
  document.getElementById('edit-character-description').value = character.description || '';
  document.getElementById('edit-character-scenario').value = character.scenario || '';
  document.getElementById('edit-character-mes-example').value = character.mes_example || '';

  // Load advanced fields
  document.getElementById('edit-character-post-history').value = character.post_history_instructions || '';
  document.getElementById('edit-character-alt-greetings').value =
    character.alternate_greetings ? character.alternate_greetings.join('\n') : '';

  // Load metadata fields
  document.getElementById('edit-character-tags').value =
    character.tags ? character.tags.join(', ') : '';
  document.getElementById('edit-character-creator').value = character.creator || '';
  document.getElementById('edit-character-version').value = character.character_version || '';
  document.getElementById('edit-character-creator-notes').value = character.creator_notes || '';

  // Load avatar preview
  const avatarCircle = document.getElementById('edit-avatar-circle');
  const removeBtn = document.getElementById('edit-remove-avatar-btn');

  // Make avatar circle uploadable for edit modal
  const handleEditAvatarUpload = async () => {
    try {
      const characterId = document.getElementById('edit-character-id').value;
      const avatarFilename = await invoke('select_and_upload_avatar', {
        characterId: characterId
      });

      // Update preview
      const avatarUrl = await getAvatarUrl(avatarFilename);
      if (avatarUrl) {
        avatarCircle.style.backgroundImage = `url('${avatarUrl}')`;
        removeBtn.style.display = 'inline-block';
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      if (error && !error.toString().includes('No file selected')) {
        setStatus('Failed to upload avatar', 'error');
      }
    }
  };
  makeAvatarUploadable(avatarCircle, handleEditAvatarUpload);

  if (character.avatar_path) {
    const avatarUrl = await getAvatarUrl(character.avatar_path);
    if (avatarUrl) {
      avatarCircle.style.backgroundImage = `url('${avatarUrl}')`;
      removeBtn.style.display = 'inline-block';
    } else {
      avatarCircle.style.backgroundImage = '';
      removeBtn.style.display = 'none';
    }
  } else {
    avatarCircle.style.backgroundImage = '';
    removeBtn.style.display = 'none';
  }

  // Load expressions
  await loadEditExpressionsGallery(character.id);

  // Load default expression
  const defaultExprSelect = document.getElementById('edit-default-expression-select');
  if (character.default_expression) {
    defaultExprSelect.value = character.default_expression;
  } else {
    defaultExprSelect.value = '';
  }

  // Show modal
  modal.style.display = 'flex';
}

// Load expressions gallery for edit modal
async function loadEditExpressionsGallery(characterId) {
  try {
    const expressions = await invoke('get_character_expressions', { characterId });
    const gallery = document.getElementById('edit-expressions-gallery');
    const defaultSelect = document.getElementById('edit-default-expression-select');

    // Clear gallery
    gallery.innerHTML = '';

    // Clear and repopulate default expression select
    defaultSelect.innerHTML = '<option value="">None</option>';

    // Display each expression
    for (const [exprName, filename] of Object.entries(expressions)) {
      // Get full path to expression image
      const fullPath = await invoke('get_expression_full_path', {
        characterId,
        expressionFilename: filename
      });

      // Create expression item
      const item = document.createElement('div');
      item.className = 'expression-item';
      item.innerHTML = `
        <img src="${convertFileSrc(fullPath)}" alt="${exprName}" />
        <div class="expression-item-name">${exprName}</div>
        <button class="expression-item-delete" data-expr-name="${exprName}" title="Delete expression">×</button>
      `;

      // Add delete handler
      const deleteBtn = item.querySelector('.expression-item-delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleEditDeleteExpression(characterId, exprName);
      });

      gallery.appendChild(item);

      // Add to default expression select
      const option = document.createElement('option');
      option.value = exprName;
      option.textContent = exprName;
      defaultSelect.appendChild(option);
    }
  } catch (error) {
    console.error('Failed to load expressions:', error);
  }
}

// Handle upload expression from edit modal
async function handleEditUploadExpression() {
  const nameInput = document.getElementById('edit-expression-name-input');
  const expressionName = nameInput.value.trim();

  if (!expressionName) {
    await window.__TAURI__.dialog.message('Please enter an expression name first', {
      title: 'Error',
      kind: 'error'
    });
    return;
  }

  // Validate expression name (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(expressionName)) {
    await window.__TAURI__.dialog.message('Expression name can only contain letters, numbers, hyphens, and underscores', {
      title: 'Error',
      kind: 'error'
    });
    return;
  }

  try {
    const characterId = document.getElementById('edit-character-id').value;
    await invoke('select_and_upload_expression', {
      characterId,
      expressionName
    });

    // Clear input and reload gallery
    nameInput.value = '';
    await loadEditExpressionsGallery(characterId);
  } catch (error) {
    console.error('Failed to upload expression:', error);
    if (error && !error.toString().includes('No file selected')) {
      await window.__TAURI__.dialog.message(`Failed to upload expression: ${error}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  }
}

// Handle delete expression from edit modal
async function handleEditDeleteExpression(characterId, expressionName) {
  const confirmed = await window.__TAURI__.dialog.confirm(
    `Delete expression "${expressionName}"?`,
    { title: 'Confirm Delete', kind: 'warning' }
  );

  if (!confirmed) {
    return;
  }

  try {
    await invoke('delete_expression', { characterId, expressionName });
    await loadEditExpressionsGallery(characterId);
  } catch (error) {
    console.error('Failed to delete expression:', error);
    await window.__TAURI__.dialog.message(`Failed to delete expression: ${error}`, {
      title: 'Error',
      kind: 'error'
    });
  }
}

// Handle duplicate character
async function handleDuplicateCharacter(character) {
  try {
    setStatus('Duplicating character...', 'default');
    const newCharacter = await invoke('duplicate_character', { characterId: character.id });
    await loadCharacters();
    setStatus(`Created ${newCharacter.name}`, 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to duplicate character:', error);
    setStatus('Failed to duplicate character', 'error');
    await window.__TAURI__.dialog.message(`Failed to duplicate character: ${error}`, {
      title: 'Error',
      kind: 'error'
    });
  }
}

// Handle export character from sidebar
async function handleExportCharacterFromSidebar(character) {
  try {
    const outputPath = await invoke('export_character_card', { characterId: character.id });
    showSuccess('Character Exported', `Successfully exported to ${outputPath}`, 4000);
  } catch (error) {
    console.error('Failed to export character:', error);
    if (error && !error.toString().includes('cancelled')) {
      showError('Export Failed', `Failed to export character: ${error}`);
    }
  }
}

// Handle delete character from sidebar
async function handleDeleteCharacterFromSidebar(character) {
  if (character.id === 'default') {
    await window.__TAURI__.dialog.message('Cannot delete the default character.', {
      title: 'Cannot Delete',
      kind: 'warning'
    });
    return;
  }

  const confirmed = await window.__TAURI__.dialog.confirm(
    `Are you sure you want to delete "${character.name}"? This action cannot be undone.`,
    {
      title: 'Delete Character',
      kind: 'warning'
    }
  );

  if (confirmed) {
    try {
      setStatus('Deleting character...', 'default');
      await invoke('delete_character', { characterId: character.id });
      await loadCharacters();
      setStatus('Character deleted', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
    } catch (error) {
      console.error('Failed to delete character:', error);
      setStatus('Failed to delete character', 'error');
      await window.__TAURI__.dialog.message(`Failed to delete character: ${error}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  }
}

// Show chat menu dropdown
function showChatMenu(character, chat, buttonEl) {
  // Close any existing menus
  document.querySelectorAll('.character-menu-dropdown').forEach(m => m.remove());

  // Create dropdown
  const menu = document.createElement('div');
  menu.className = 'character-menu-dropdown show';

  menu.innerHTML = `
    <div class="character-menu-item" data-action="rename">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M10.5 1.5L12.5 3.5L4.5 11.5L1.5 12.5L2.5 9.5L10.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Rename Chat
    </div>
    <div class="character-menu-item danger" data-action="delete">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4H12M5 4V2H9V4M3 4L4 12H10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Delete Chat
    </div>
  `;

  // Position menu relative to button
  const buttonRect = buttonEl.getBoundingClientRect();
  const parent = buttonEl.parentElement.parentElement;  // Get the chat card
  const parentRect = parent.getBoundingClientRect();

  menu.style.position = 'absolute';
  menu.style.top = `${buttonRect.bottom - parentRect.top + 4}px`;
  menu.style.right = `${parentRect.right - buttonRect.right}px`;

  // Add click handlers
  menu.querySelectorAll('.character-menu-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      menu.remove();

      switch (action) {
        case 'rename':
          await handleRenameChatFromList(character, chat);
          break;
        case 'delete':
          await handleDeleteChatFromList(character, chat);
          break;
      }
    });
  });

  parent.style.position = 'relative';
  parent.appendChild(menu);

  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== buttonEl) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

// Handle rename chat from list
async function handleRenameChatFromList(character, chat) {
  const newName = await window.__TAURI__.dialog.ask(
    `Enter a new name for this chat:`,
    {
      title: 'Rename Chat',
      defaultPath: chat.name
    }
  );

  if (newName && newName !== chat.name) {
    try {
      setStatus('Renaming chat...', 'default');
      await invoke('rename_chat', {
        characterId: character.id,
        chatId: chat.id,
        newName: newName
      });
      // Refresh the chat list
      await showChatListForCharacter(character);
      setStatus('Chat renamed', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
    } catch (error) {
      console.error('Failed to rename chat:', error);
      setStatus('Failed to rename chat', 'error');
      await window.__TAURI__.dialog.message(`Failed to rename chat: ${error}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  }
}

// Handle delete chat from list
async function handleDeleteChatFromList(character, chat) {
  const confirmed = await window.__TAURI__.dialog.confirm(
    `Are you sure you want to delete "${chat.name}"? This will delete all messages and branches in this chat. This action cannot be undone.`,
    {
      title: 'Delete Chat',
      kind: 'warning'
    }
  );

  if (confirmed) {
    try {
      setStatus('Deleting chat...', 'default');
      await invoke('delete_chat', {
        characterId: character.id,
        chatId: chat.id
      });
      // Refresh the chat list
      await showChatListForCharacter(character);
      setStatus('Chat deleted', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
    } catch (error) {
      console.error('Failed to delete chat:', error);
      setStatus('Failed to delete chat', 'error');
      await window.__TAURI__.dialog.message(`Failed to delete chat: ${error}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  }
}

// Show branch list for a character
// Show chat list for a character
async function showChatListForCharacter(character) {
  try {
    // Set this character as active
    await invoke('set_active_character', { characterId: character.id });

    // Trigger migration if needed (backend handles this automatically)
    const chats = await invoke('list_chats', { characterId: character.id });

    // Clear the chat area and show chat list
    messagesContainer.innerHTML = '';

    const chatListView = document.createElement('div');
    chatListView.className = 'branch-list-view';

    chatListView.innerHTML = `
      <div class="branch-list-header">
        <h2>${character.name}</h2>
        <p>Select a conversation to continue</p>
      </div>

      <div class="branch-list-actions">
        <button class="btn-primary" id="new-chat-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px;">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          New Conversation
        </button>
      </div>

      <div class="branch-list" id="chat-list">
        <!-- Chats will be inserted here -->
      </div>
    `;

    messagesContainer.appendChild(chatListView);

    // Populate chats
    const chatList = document.getElementById('chat-list');

    chats.forEach(chat => {
      const chatCard = document.createElement('div');
      chatCard.className = 'branch-card';

      const messageCount = chat.message_count || 0;
      const branchCount = chat.branch_count || 1;
      const createdDate = chat.created_at ? new Date(chat.created_at).toLocaleDateString() : 'Unknown';
      const lastMessageDate = chat.last_message_at ? new Date(chat.last_message_at).toLocaleDateString() : null;

      chatCard.innerHTML = `
        <div class="branch-card-header">
          <div class="branch-card-name">${chat.name}</div>
          <button class="character-menu-btn chat-menu-btn" title="Chat options">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="branch-card-meta">
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            Created: ${createdDate}
          </div>
          ${lastMessageDate ? `
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.2"/>
            </svg>
            Last: ${lastMessageDate}
          </div>
          ` : ''}
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            ${messageCount} messages
          </div>
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l5 5-5 5M7 2l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}
          </div>
        </div>
      `;

      // Add three-dot menu handler
      const menuBtn = chatCard.querySelector('.chat-menu-btn');
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showChatMenu(character, chat, menuBtn);
      });

      // Handle chat selection - show branches for this chat
      chatCard.addEventListener('click', async () => {
        await showBranchListForChat(character, chat);
      });

      chatList.appendChild(chatCard);
    });

    // Handle new chat creation
    document.getElementById('new-chat-btn').addEventListener('click', async () => {
      try {
        const chatName = `Conversation ${chats.length + 1}`;
        const newChat = await invoke('create_chat', {
          characterId: character.id,
          name: chatName
        });
        await showBranchListForChat(character, newChat);
      } catch (error) {
        console.error('Failed to create chat:', error);
        await window.__TAURI__.dialog.message(`Failed to create conversation: ${error}`, {
          title: 'Error',
          kind: 'error'
        });
      }
    });

  } catch (error) {
    console.error('Failed to load chats:', error);
    addMessage(`Failed to load conversations: ${error}`, false);
  }
}

// Show branch list for a specific chat
async function showBranchListForChat(character, chat) {
  try {
    // Switch to this chat (loads the chat and returns messages)
    await invoke('switch_chat', { chatId: chat.id });

    // Get branches for this chat
    const branches = await invoke('list_branches');
    const activeBranchId = await invoke('get_active_branch_id');

    // Clear the chat area and show branch list
    messagesContainer.innerHTML = '';

    const branchListView = document.createElement('div');
    branchListView.className = 'branch-list-view';

    branchListView.innerHTML = `
      <div class="branch-list-header">
        <button class="btn-back" id="back-to-chats">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div>
          <h2>${chat.name}</h2>
          <p>Select a branch to continue</p>
        </div>
      </div>

      <div class="branch-list-actions">
        <button class="btn-primary" id="new-branch-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right: 6px;">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          New Branch
        </button>
      </div>

      <div class="branch-list" id="branch-list">
        <!-- Branches will be inserted here -->
      </div>
    `;

    messagesContainer.appendChild(branchListView);

    // Back button handler
    document.getElementById('back-to-chats').addEventListener('click', async () => {
      await showChatListForCharacter(character);
    });

    // Populate branches
    const branchList = document.getElementById('branch-list');

    branches.forEach(branch => {
      const branchCard = document.createElement('div');
      branchCard.className = 'branch-card';

      const isActive = branch.id === activeBranchId;
      const messageCount = branch.message_count || 0;
      const createdDate = branch.created_at ? new Date(branch.created_at).toLocaleDateString() : 'Unknown';
      const lastMessageDate = branch.last_message_at ? new Date(branch.last_message_at).toLocaleDateString() : null;

      branchCard.innerHTML = `
        <div class="branch-card-header">
          <div class="branch-card-name">${branch.name}</div>
          ${isActive ? '<div class="branch-card-badge">Current</div>' : ''}
        </div>
        <div class="branch-card-meta">
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            Created: ${createdDate}
          </div>
          ${lastMessageDate ? `
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.2"/>
            </svg>
            Last: ${lastMessageDate}
          </div>
          ` : ''}
          <div class="branch-card-meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            ${messageCount} messages
          </div>
        </div>
      `;

      // Handle branch selection
      branchCard.addEventListener('click', async () => {
        await loadBranch(character.id, branch.id);
      });

      branchList.appendChild(branchCard);
    });

    // Handle new branch creation
    document.getElementById('new-branch-btn').addEventListener('click', async () => {
      const branchName = await window.__TAURI__.dialog.confirm('Create a new chat branch?', {
        title: 'New Branch',
        kind: 'info'
      });

      if (branchName) {
        try {
          // Create branch from message 0 (empty branch)
          const newBranch = await invoke('create_branch', {
            messageIndex: 0,
            branchName: `Branch ${branches.length + 1}`
          });
          await loadBranch(character.id, newBranch.id);
        } catch (error) {
          console.error('Failed to create branch:', error);
          await window.__TAURI__.dialog.message(`Failed to create branch: ${error}`, {
            title: 'Error',
            kind: 'error'
          });
        }
      }
    });

  } catch (error) {
    console.error('Failed to load branches:', error);
    addMessage(`Failed to load branches: ${error}`, false);
  }
}

// Legacy function - redirects to new chat list view
async function showBranchListForCharacter(character) {
  await showChatListForCharacter(character);
}

// Load a specific branch for a character
async function loadBranch(characterId, branchId) {
  try {
    setStatus('Loading chat...', 'default');
    await invoke('set_active_character', { characterId });
    await invoke('switch_branch', { branchId });
    await loadCharacters();
    setStatus('Chat loaded', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to load branch:', error);
    setStatus('Failed to load chat', 'error');
    await window.__TAURI__.dialog.message(`Failed to load chat: ${error}`, {
      title: 'Error',
      kind: 'error'
    });
  }
}

// Setup character filter panel
function setupCharacterFilter() {
  const filterBtn = document.getElementById('character-filter-btn');
  const filterPanel = document.getElementById('character-filter-panel');
  const filterInput = document.getElementById('character-filter-input');
  const sortSelect = document.getElementById('character-sort-select');

  if (!filterBtn || !filterPanel || !filterInput || !sortSelect) return;

  // Toggle filter panel
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = filterPanel.style.display !== 'none';
    filterPanel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      filterInput.focus();
    }
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!filterPanel.contains(e.target) && e.target !== filterBtn) {
      filterPanel.style.display = 'none';
    }
  });

  // Filter input
  filterInput.addEventListener('input', (e) => {
    characterFilterText = e.target.value;
    populateCharacterDropdown(allCharacters, allGroupChats);
  });

  // Sort select
  sortSelect.addEventListener('change', (e) => {
    characterSortOrder = e.target.value;
    populateCharacterDropdown(allCharacters, allGroupChats);
  });
}

// Load characters and populate dropdown
async function loadCharacters() {
  console.log('Loading characters...');
  try {
    const characters = await invoke('list_characters');
    console.log('Loaded characters:', characters);

    // Load group chats
    let groupChats = [];
    try {
      groupChats = await invoke('list_group_chats');
      console.log('Loaded group chats:', groupChats);
    } catch (error) {
      console.log('No group chats or error loading them:', error);
    }

    // Store all characters and group chats for filtering/sorting
    allCharacters = characters;
    allGroupChats = groupChats;

    // Build charactersMap for quick lookup
    charactersMap = {};
    for (const char of characters) {
      charactersMap[char.id] = char;
    }

    // Populate dropdown with filtered/sorted list
    populateCharacterDropdown(characters, groupChats);

    // Populate sidebar character list (for spacious layout)
    populateSidebarCharacterList(characters, groupChats);

    const activeCharacter = await invoke('get_character');
    console.log('Active character:', activeCharacter);
    characterSelect.value = activeCharacter.id;
    characterHeaderName.textContent = activeCharacter.name;
    currentCharacter = activeCharacter;

    // Update header avatar
    const headerAvatar = document.querySelector('.avatar-circle');
    if (headerAvatar && activeCharacter.avatar_path) {
      getAvatarUrl(activeCharacter.avatar_path).then(url => {
        if (url) {
          headerAvatar.style.backgroundImage = `url('${url}')`;
          makeAvatarClickable(headerAvatar, url);
        }
      });
    } else if (headerAvatar) {
      headerAvatar.style.backgroundImage = '';
    }

    await loadChatHistory();
    await updateBranchIndicator();

    // Initialize expression display for visual novel mode
    const currentViewMode = localStorage.getItem('claudia-view-mode') || 'cozy';
    if (currentViewMode === 'visual-novel') {
      try {
        await updateExpressionDisplay();
      } catch (error) {
        console.error('Failed to initialize expression display:', error);
      }
    }

    // Load auto-saved draft for this character
    loadAutoSavedDraft();
  } catch (error) {
    console.error('Failed to load characters:', error);
    addMessage(`Failed to load characters: ${error}`, false);
  }
}

// Handle character switching
async function handleCharacterSwitch() {
  const selectedId = characterSelect.value;
  const selectedOption = characterSelect.options[characterSelect.selectedIndex];
  const selectedType = selectedOption?.dataset.type || 'character';

  setStatus('Switching...', 'default');
  messagesContainer.innerHTML = '';

  try {
    if (selectedType === 'group') {
      // Load group chat
      const groupChat = await invoke('get_group_chat', { groupId: selectedId });
      currentGroupChat = groupChat;
      currentCharacter = null;

      // Load the group's active chat history if exists
      if (groupChat.active_chat_id) {
        try {
          const chatHistory = await invoke('load_group_chat_history', {
            groupId: selectedId,
            chatId: groupChat.active_chat_id
          });

          // Get messages from active branch
          const activeBranchMessages = chatHistory.branch_messages[chatHistory.active_branch_id] || [];

          // Render messages
          for (const msg of activeBranchMessages) {
            const isUser = msg.role === 'user';
            let characterInfo = null;

            if (!isUser && msg.character_id) {
              const char = charactersMap[msg.character_id];
              if (char) {
                characterInfo = {
                  id: msg.character_id,
                  name: char.name,
                  avatar_path: char.avatar_path
                };
              }
            }

            await addMessage(msg.content, isUser, true, msg.timestamp, characterInfo);
          }
        } catch (error) {
          console.error('Failed to load group chat history:', error);
        }
      }

      // Update header
      characterHeaderName.textContent = `👥 ${groupChat.name}`;

      // Show group UI elements
      showGroupReplyControls(groupChat);
      showGroupMembersPanel(groupChat);

      setStatus('Group chat loaded', 'success');
    } else {
      // Regular character switch
      currentGroupChat = null;
      await invoke('set_active_character', { characterId: selectedId });
      await loadCharacters();

      // Hide group UI elements
      hideGroupReplyControls();
      hideGroupMembersPanel();

      setStatus('Character switched', 'success');
    }

    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to switch:', error);
    setStatus('Failed to switch', 'error');
    addMessage(`Failed to switch: ${error}`, false);
  }
}

// Handle new character creation
async function handleNewCharacter() {
  const modal = document.getElementById('new-character-modal');
  const overlay = modal.querySelector('.new-character-overlay');
  const form = document.getElementById('new-character-form');
  const nameInput = document.getElementById('new-character-name');
  const systemPromptInput = document.getElementById('new-character-system-prompt');
  const closeBtn = document.getElementById('close-new-character-btn');
  const cancelBtn = document.getElementById('cancel-new-character-btn');

  // Reset form
  form.reset();
  systemPromptInput.value = 'You are a helpful AI assistant.';

  // Reset avatar preview
  const newAvatarCircle = document.getElementById('new-avatar-circle');
  const newRemoveAvatarBtn = document.getElementById('new-remove-avatar-btn');
  newAvatarCircle.style.backgroundImage = '';
  newRemoveAvatarBtn.style.display = 'none';
  let newCharacterAvatarPath = null;

  // Show modal
  modal.style.display = 'flex';

  // Focus name input after a brief delay to ensure it's visible
  setTimeout(() => nameInput.focus(), 100);

  // Avatar upload handler for new character
  const newUploadAvatarBtn = document.getElementById('new-upload-avatar-btn');
  const handleNewAvatarUpload = async () => {
    try {
      const selected = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp']
        }]
      });

      if (selected) {
        newCharacterAvatarPath = selected;
        // Preview using file path
        const avatarUrl = convertFileSrc(selected);
        newAvatarCircle.style.backgroundImage = `url('${avatarUrl}')`;
        newRemoveAvatarBtn.style.display = 'inline-block';
      }
    } catch (error) {
      console.error('Avatar selection error:', error);
    }
  };

  const handleNewAvatarRemove = () => {
    newCharacterAvatarPath = null;
    newAvatarCircle.style.backgroundImage = '';
    newRemoveAvatarBtn.style.display = 'none';
  };

  // Make avatar circle uploadable for new character
  makeAvatarUploadable(newAvatarCircle, handleNewAvatarUpload);

  newUploadAvatarBtn.addEventListener('click', handleNewAvatarUpload);
  newRemoveAvatarBtn.addEventListener('click', handleNewAvatarRemove);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const systemPrompt = systemPromptInput.value.trim();
    const description = document.getElementById('new-character-description').value.trim() || null;
    const personality = document.getElementById('new-character-personality').value.trim() || null;
    const scenario = document.getElementById('new-character-scenario').value.trim() || null;
    const greeting = document.getElementById('new-character-greeting').value.trim() || null;
    const mesExample = document.getElementById('new-character-mes-example').value.trim() || null;

    if (!name || !systemPrompt) return;

    try {
      const newCharacter = await invoke('create_character', {
        name,
        systemPrompt,
        description,
        personality,
        scenario,
        greeting,
        mesExample
      });

      // Upload avatar if one was selected
      if (newCharacterAvatarPath) {
        try {
          await invoke('upload_avatar', {
            sourcePath: newCharacterAvatarPath,
            characterId: newCharacter.id
          });
        } catch (avatarError) {
          console.error('Failed to upload avatar:', avatarError);
          // Continue anyway - character was created successfully
        }
      }

      await loadCharacters();
      characterSelect.value = newCharacter.id;

      // Hide modal
      modal.style.display = 'none';

      // Remove event listeners
      form.removeEventListener('submit', handleSubmit);
      overlay.removeEventListener('click', handleClose);
      closeBtn.removeEventListener('click', handleClose);
      cancelBtn.removeEventListener('click', handleClose);
      newUploadAvatarBtn.removeEventListener('click', handleNewAvatarUpload);
      newRemoveAvatarBtn.removeEventListener('click', handleNewAvatarRemove);
    } catch (error) {
      console.error('Failed to create character:', error);
      addMessage(`Failed to create character: ${error}`, false);
    }
  };

  // Handle close
  const handleClose = () => {
    modal.style.display = 'none';
    form.removeEventListener('submit', handleSubmit);
    overlay.removeEventListener('click', handleClose);
    closeBtn.removeEventListener('click', handleClose);
    cancelBtn.removeEventListener('click', handleClose);
    newUploadAvatarBtn.removeEventListener('click', handleNewAvatarUpload);
    newRemoveAvatarBtn.removeEventListener('click', handleNewAvatarRemove);
  };

  // Attach event listeners
  form.addEventListener('submit', handleSubmit);
  overlay.addEventListener('click', handleClose);
  closeBtn.addEventListener('click', handleClose);
  cancelBtn.addEventListener('click', handleClose);
}

// Handle character deletion
async function handleDeleteCharacter() {
  if (!currentCharacter || currentCharacter.id === 'default') {
    showWarning('Cannot Delete', 'The default character cannot be deleted.');
    return;
  }

  const confirmed = await showConfirmDialog({
    type: 'danger',
    title: 'Delete Character?',
    message: `Are you sure you want to delete "${currentCharacter.name}"? All chat history for this character will be permanently lost. This action cannot be undone.`,
    confirmText: 'Delete Character'
  });

  if (confirmed) {
    try {
      const characterName = currentCharacter.name;
      await invoke('delete_character', { characterId: currentCharacter.id });
      await loadCharacters();
      hideSettings();
      showSuccess('Character Deleted', `${characterName} has been deleted successfully.`);
    } catch (error) {
      console.error('Failed to delete character:', error);
      showError('Delete Failed', `Failed to delete character: ${error}`);
    }
  }
}

// Handle character card import
async function handleImportCharacter() {
  try {
    const importedCharacter = await invoke('import_character_card');
    showSuccess('Character Imported', `${importedCharacter.name} has been imported successfully!`);

    // Reload characters and switch to the imported one
    await loadCharacters();
    await loadCharacterSettings();
  } catch (error) {
    console.error('Failed to import character:', error);
    if (error && !error.toString().includes('No file selected') && !error.toString().includes('cancelled')) {
      showError('Import Failed', `Failed to import character: ${error}`);
    }
  }
}

// Handle character card export
async function handleExportCharacter() {
  try {
    const characterId = document.getElementById('character-settings-select').value;
    const outputPath = await invoke('export_character_card', { characterId });
    showSuccess('Character Exported', `Successfully exported to ${outputPath}`, 4000);
  } catch (error) {
    console.error('Failed to export character:', error);
    if (error && !error.toString().includes('cancelled')) {
      showError('Export Failed', `Failed to export character: ${error}`);
    }
  }
}

// Load chat history
async function loadChatHistory() {
  try {
    // Show skeleton loader while loading
    showMessageSkeleton(3);

    const history = await invoke('get_chat_history');
    messagesContainer.innerHTML = '';

    if (history.length === 0) {
      if (currentCharacter && currentCharacter.greeting) {
        await addMessage(currentCharacter.greeting, false, true);
      } else {
        // Show empty state
        showEmptyState(messagesContainer, {
          icon: '👋',
          title: 'Start a Conversation',
          description: 'Send a message to begin chatting with your character. Your conversation history will appear here.',
          actionText: null
        });
      }
    } else {
      for (const msg of history) {
        const messageDiv = await addMessage(msg.content, msg.role === 'user', false, msg.timestamp);

        // Apply pinned state
        if (msg.pinned && messageDiv) {
          messageDiv.classList.add('pinned');
          const pinBtn = messageDiv.querySelector('.message-pin-btn');
          if (pinBtn) {
            pinBtn.classList.add('active');
            pinBtn.title = 'Unpin message';
          }
        }

        // Apply hidden state
        if (msg.hidden && messageDiv) {
          messageDiv.classList.add('hidden-message');
          const hideBtn = messageDiv.querySelector('.message-hide-btn');
          if (hideBtn) {
            hideBtn.classList.add('active');
            hideBtn.title = 'Unhide message';
            hideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10 5L11.5 3.5M3.5 10.5L5 9M1 13L13 1M5.5 6C5.19 6.31 5 6.74 5 7.22C5 8.2 5.8 9 6.78 9C7.26 9 7.69 8.81 8 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>`;
          }
        }

        // Update swipe controls for assistant messages with swipe info
        if (msg.role === 'assistant' && messageDiv && msg.swipes && msg.swipes.length > 0) {
          updateSwipeControls(messageDiv, msg.current_swipe || 0, msg.swipes.length);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load chat history:', error);
    messagesContainer.innerHTML = '';
    addMessage('API configured. Ready to chat.', false, true);
  }

  // Update token count after loading history
  updateTokenCount();
}

// Clear chat history
async function clearHistory() {
  const confirmed = await showConfirmDialog({
    type: 'danger',
    title: 'Clear Conversation?',
    message: 'This will permanently delete all messages in this conversation. This action cannot be undone.',
    confirmText: 'Clear History'
  });

  if (!confirmed) {
    return;
  }

  setStatus('Clearing history...', 'default');
  try {
    await invoke('clear_chat_history');
    messagesContainer.innerHTML = '';
    if (currentCharacter && currentCharacter.greeting) {
      await addMessage(currentCharacter.greeting, false, true);
    } else {
      await addMessage('Conversation cleared. Ready to chat.', false, true);
    }
    setStatus('Ready');
    showSuccess('History Cleared', 'Conversation history has been cleared.');
  } catch (error) {
    setStatus('Ready');
    showError('Clear Failed', `Failed to clear history: ${error}`);
  }
}

// Load character settings
async function loadCharacterSettings() {
  try {
    const characters = await invoke('list_characters');
    const characterSettingsSelect = document.getElementById('character-settings-select');
    characterSettingsSelect.innerHTML = '';
    characters.forEach(char => {
      const option = document.createElement('option');
      option.value = char.id;
      option.textContent = char.name;
      characterSettingsSelect.appendChild(option);
    });

    const character = await invoke('get_character');
    characterSettingsSelect.value = character.id;
    document.getElementById('character-name').value = character.name;
    document.getElementById('character-system-prompt').value = character.system_prompt;
    document.getElementById('character-greeting').value = character.greeting || '';
    document.getElementById('character-personality').value = character.personality || '';
    document.getElementById('character-description').value = character.description || '';
    document.getElementById('character-scenario').value = character.scenario || '';
    document.getElementById('character-mes-example').value = character.mes_example || '';
    document.getElementById('character-post-history').value = character.post_history_instructions || '';
    document.getElementById('character-alt-greetings').value = character.alternate_greetings ? character.alternate_greetings.join('\n') : '';
    document.getElementById('character-tags').value = character.tags ? character.tags.join(', ') : '';
    document.getElementById('character-creator').value = character.creator || '';
    document.getElementById('character-version').value = character.character_version || '';
    document.getElementById('character-creator-notes').value = character.creator_notes || '';

    // Load avatar preview
    const avatarPreview = document.querySelector('.avatar-circle-large');
    const removeAvatarBtn = document.getElementById('remove-avatar-btn');

    // Make avatar circle uploadable (clickable + drag-drop)
    makeAvatarUploadable(avatarPreview, handleAvatarUpload);

    if (character.avatar_path) {
      getAvatarUrl(character.avatar_path).then(url => {
        if (url) {
          avatarPreview.style.backgroundImage = `url('${url}')`;
          makeAvatarClickable(avatarPreview, url);
        }
      });
      removeAvatarBtn.style.display = 'inline-block';
      pendingAvatarPath = character.avatar_path;
    } else {
      avatarPreview.style.backgroundImage = '';
      removeAvatarBtn.style.display = 'none';
      pendingAvatarPath = null;
    }

    // Load expressions
    await loadExpressionsGallery(character.id);

    // Load message examples settings
    try {
      const settings = await invoke('get_roleplay_settings', { characterId: character.id });
      document.getElementById('examples-enabled').checked = settings.examples_enabled || false;
      document.getElementById('examples-position').value = settings.examples_position || 'after_system';
    } catch (error) {
      console.error('Failed to load examples settings:', error);
      // Set defaults if loading fails
      document.getElementById('examples-enabled').checked = false;
      document.getElementById('examples-position').value = 'after_system';
    }
  } catch (error) {
    console.error('Failed to load character:', error);
  }
}

// Save character settings
async function handleSaveCharacter(e) {
  e.preventDefault();

  const name = document.getElementById('character-name').value.trim();
  const systemPrompt = document.getElementById('character-system-prompt').value.trim();
  const greeting = document.getElementById('character-greeting').value.trim() || null;
  const personality = document.getElementById('character-personality').value.trim() || null;
  const description = document.getElementById('character-description').value.trim() || null;
  const scenario = document.getElementById('character-scenario').value.trim() || null;
  const mesExample = document.getElementById('character-mes-example').value.trim() || null;
  const postHistory = document.getElementById('character-post-history').value.trim() || null;
  const altGreetingsText = document.getElementById('character-alt-greetings').value.trim();
  const altGreetings = altGreetingsText ? altGreetingsText.split('\n').map(s => s.trim()).filter(s => s) : null;
  const tagsText = document.getElementById('character-tags').value.trim();
  const tags = tagsText ? tagsText.split(',').map(s => s.trim()).filter(s => s) : null;
  const creator = document.getElementById('character-creator').value.trim() || null;
  const characterVersion = document.getElementById('character-version').value.trim() || null;
  const creatorNotes = document.getElementById('character-creator-notes').value.trim() || null;
  const saveBtn = document.getElementById('save-character-btn');
  const characterMsg = document.getElementById('character-message');

  if (!name || !systemPrompt) {
    showWarning('Missing Fields', 'Name and System Prompt are required.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.classList.add('loading');
  saveBtn.textContent = 'Saving...';

  try {
    await invoke('update_character', {
      name,
      systemPrompt,
      greeting,
      personality,
      description,
      scenario,
      mesExample,
      postHistory,
      altGreetings,
      tags,
      creator,
      characterVersion,
      creatorNotes,
      avatarPath: pendingAvatarPath
    });

    // Also save message examples settings
    const characterId = document.getElementById('character-settings-select').value;
    const examplesEnabled = document.getElementById('examples-enabled').checked;
    const examplesPosition = document.getElementById('examples-position').value;

    await invoke('update_examples_settings', {
      characterId,
      enabled: examplesEnabled,
      position: examplesPosition
    });

    // Update currentRoleplaySettings if available
    if (currentRoleplaySettings) {
      currentRoleplaySettings.examples_enabled = examplesEnabled;
      currentRoleplaySettings.examples_position = examplesPosition;
    }

    await loadCharacters();
    updateFeatureBadges();
    showSuccess('Character Saved', `${name} has been saved successfully.`);
  } catch (error) {
    showError('Save Failed', `Failed to save character: ${error}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove('loading');
    saveBtn.textContent = 'Save Character';
  }
}

// World Info / Roleplay Settings Management

let currentRoleplaySettings = null;

// Load roleplay settings for current character
async function loadRoleplaySettings() {
  if (!currentCharacter) return;

  try {
    const settings = await invoke('get_roleplay_settings', { characterId: currentCharacter.id });
    currentRoleplaySettings = settings;

    // Load World Info entries
    renderWorldInfoList(settings.world_info || []);

    // Load World Info recursion depth
    document.getElementById('recursion-depth').value = settings.recursion_depth || 3;

    // Load Author's Note
    document.getElementById('authors-note-text').value = settings.authors_note || '';
    document.getElementById('authors-note-enabled').checked = settings.authors_note_enabled || false;

    // Load Persona
    document.getElementById('persona-name').value = settings.persona_name || '';
    document.getElementById('persona-description').value = settings.persona_description || '';
    document.getElementById('persona-enabled').checked = settings.persona_enabled || false;

    // Message Examples settings now loaded in Character Tab (loadCharacterSettings)

    // Load Presets
    await loadPresets();

    // Update feature badges
    updateFeatureBadges();
  } catch (error) {
    console.error('Failed to load roleplay settings:', error);
  }
}

// Update feature badges in header
function updateFeatureBadges() {
  const badgesContainer = document.getElementById('feature-badges');
  if (!badgesContainer || !currentRoleplaySettings) {
    if (badgesContainer) badgesContainer.innerHTML = '';
    return;
  }

  badgesContainer.innerHTML = '';

  // World Info badge - show count of enabled entries
  const worldInfoEntries = (currentRoleplaySettings.world_info || []).filter(entry => entry.enabled);
  if (worldInfoEntries.length > 0) {
    const badge = document.createElement('div');
    badge.className = 'feature-badge';
    badge.title = `${worldInfoEntries.length} World Info ${worldInfoEntries.length === 1 ? 'entry' : 'entries'} active`;
    badge.innerHTML = `
      <svg class="feature-badge-icon" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>WI: <span class="feature-badge-count">${worldInfoEntries.length}</span></span>
    `;
    badgesContainer.appendChild(badge);
  }

  // Persona badge
  if (currentRoleplaySettings.persona_enabled && currentRoleplaySettings.persona_name) {
    const badge = document.createElement('div');
    badge.className = 'feature-badge';
    badge.title = `Persona: ${currentRoleplaySettings.persona_name}`;
    badge.innerHTML = `
      <svg class="feature-badge-icon" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M3 13c0-2.5 2-4 5-4s5 1.5 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>${currentRoleplaySettings.persona_name}</span>
    `;
    badgesContainer.appendChild(badge);
  }

  // Preset badge
  const presetSelect = document.getElementById('preset-select');
  if (presetSelect && presetSelect.value) {
    const presetName = presetSelect.options[presetSelect.selectedIndex]?.text || presetSelect.value;
    const badge = document.createElement('div');
    badge.className = 'feature-badge';
    badge.title = `Active Preset: ${presetName}`;
    badge.innerHTML = `
      <svg class="feature-badge-icon" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
        <path d="M6 7h4M6 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>${presetName}</span>
    `;
    badgesContainer.appendChild(badge);
  }

  // Message Examples badge
  if (currentRoleplaySettings.examples_enabled) {
    const badge = document.createElement('div');
    badge.className = 'feature-badge';
    badge.title = 'Message Examples enabled';
    badge.innerHTML = `
      <svg class="feature-badge-icon" viewBox="0 0 16 16" fill="none">
        <path d="M3 6l2 2-2 2M7 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Examples</span>
    `;
    badgesContainer.appendChild(badge);
  }

  // Author's Note badge
  if (currentRoleplaySettings.authors_note_enabled && currentRoleplaySettings.authors_note) {
    const badge = document.createElement('div');
    badge.className = 'feature-badge';
    badge.title = "Author's Note enabled";
    badge.innerHTML = `
      <svg class="feature-badge-icon" viewBox="0 0 16 16" fill="none">
        <path d="M3 3h10v10H3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M6 6h4M6 9h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>A/N</span>
    `;
    badgesContainer.appendChild(badge);
  }
}

// Render World Info entries
function renderWorldInfoList(entries) {
  const listContainer = document.getElementById('worldinfo-list');
  listContainer.innerHTML = '';

  if (entries.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.color = 'var(--text-secondary)';
    emptyMsg.style.fontSize = '14px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '20px';
    emptyMsg.textContent = 'No entries yet. Click "Add Entry" to create one.';
    listContainer.appendChild(emptyMsg);
    return;
  }

  // Sort entries by priority (higher first)
  const sortedEntries = [...entries].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  sortedEntries.forEach(entry => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'worldinfo-entry';
    entryDiv.dataset.entryId = entry.id;

    const header = document.createElement('div');
    header.className = 'worldinfo-entry-header';

    const enableCheckbox = document.createElement('input');
    enableCheckbox.type = 'checkbox';
    enableCheckbox.checked = entry.enabled;
    enableCheckbox.addEventListener('change', () => handleToggleWorldInfoEntry(entry.id, enableCheckbox.checked));

    const infoSection = document.createElement('div');
    infoSection.className = 'worldinfo-info-section';

    const keysText = document.createElement('div');
    keysText.className = 'worldinfo-keys';
    keysText.textContent = entry.keys.join(', ');

    // Add content preview
    const contentPreview = document.createElement('div');
    contentPreview.className = 'worldinfo-content-preview';
    const maxLength = 100;
    const previewText = entry.content.length > maxLength
      ? entry.content.substring(0, maxLength) + '...'
      : entry.content;
    contentPreview.textContent = previewText;

    infoSection.appendChild(keysText);
    infoSection.appendChild(contentPreview);

    const priority = document.createElement('span');
    priority.className = 'worldinfo-priority';
    priority.textContent = `Priority: ${entry.priority || 0}`;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'worldinfo-entry-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'worldinfo-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => handleEditWorldInfoEntry(entry));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'worldinfo-btn worldinfo-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDeleteWorldInfoEntry(entry.id));

    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);

    header.appendChild(enableCheckbox);
    header.appendChild(infoSection);
    header.appendChild(priority);
    header.appendChild(actionsDiv);

    entryDiv.appendChild(header);
    listContainer.appendChild(entryDiv);
  });
}

// Add new World Info entry
async function handleAddWorldInfoEntry() {
  const listContainer = document.getElementById('worldinfo-list');

  // Check if form already exists
  if (document.getElementById('worldinfo-add-form')) return;

  // Create inline form
  const formDiv = document.createElement('div');
  formDiv.id = 'worldinfo-add-form';
  formDiv.className = 'worldinfo-entry worldinfo-edit-form';

  formDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Add World Info Entry</div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Keywords (comma-separated)</label>
        <input type="text" id="wi-add-keys" placeholder="John, John Smith" style="width: 100%;" />
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Content</label>
        <textarea id="wi-add-content" placeholder="Information to inject when keywords are found..." rows="4" style="width: 100%;"></textarea>
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Priority</label>
        <input type="number" id="wi-add-priority" value="0" min="0" style="width: 100px;" />
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn" id="wi-add-cancel">Cancel</button>
        <button type="button" class="worldinfo-btn" id="wi-add-save" style="background: var(--accent); color: white;">Save</button>
      </div>
    </div>
  `;

  listContainer.prepend(formDiv);

  // Focus first input
  document.getElementById('wi-add-keys').focus();

  // Handle cancel
  document.getElementById('wi-add-cancel').addEventListener('click', () => {
    formDiv.remove();
  });

  // Handle save
  document.getElementById('wi-add-save').addEventListener('click', async () => {
    const keys = document.getElementById('wi-add-keys').value.trim();
    const content = document.getElementById('wi-add-content').value.trim();
    const priority = parseInt(document.getElementById('wi-add-priority').value) || 0;

    if (!keys || !content) {
      alert('Keywords and content are required');
      return;
    }

    try {
      const keysArray = keys.split(',').map(k => k.trim()).filter(k => k);
      await invoke('add_world_info_entry', {
        characterId: currentCharacter.id,
        keys: keysArray,
        content: content,
        priority,
        caseSensitive: false
      });

      formDiv.remove();
      await loadRoleplaySettings();
    } catch (error) {
      console.error('Failed to add World Info entry:', error);
      alert(`Failed to add entry: ${error}`);
    }
  });
}

// Edit World Info entry
async function handleEditWorldInfoEntry(entry) {
  const entryDiv = document.querySelector(`.worldinfo-entry[data-entry-id="${entry.id}"]`);
  if (!entryDiv) return;

  // Check if already editing
  if (entryDiv.querySelector('.worldinfo-inline-edit')) return;

  // Hide normal content
  const header = entryDiv.querySelector('.worldinfo-entry-header');
  const content = entryDiv.querySelector('.worldinfo-entry-content');
  header.style.display = 'none';
  content.style.display = 'none';

  // Create inline edit form
  const editForm = document.createElement('div');
  editForm.className = 'worldinfo-inline-edit';
  editForm.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Edit Entry</div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Keywords (comma-separated)</label>
        <input type="text" class="wi-edit-keys" value="${entry.keys.join(', ')}" style="width: 100%;" />
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Content</label>
        <textarea class="wi-edit-content" rows="4" style="width: 100%;">${entry.content}</textarea>
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Priority</label>
        <input type="number" class="wi-edit-priority" value="${entry.priority || 0}" min="0" style="width: 100px;" />
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn wi-edit-cancel">Cancel</button>
        <button type="button" class="worldinfo-btn wi-edit-save" style="background: var(--accent); color: white;">Save</button>
      </div>
    </div>
  `;

  entryDiv.appendChild(editForm);

  // Focus first input
  editForm.querySelector('.wi-edit-keys').focus();

  // Handle cancel
  editForm.querySelector('.wi-edit-cancel').addEventListener('click', () => {
    header.style.display = '';
    content.style.display = '';
    editForm.remove();
  });

  // Handle save
  editForm.querySelector('.wi-edit-save').addEventListener('click', async () => {
    const keys = editForm.querySelector('.wi-edit-keys').value.trim();
    const contentText = editForm.querySelector('.wi-edit-content').value.trim();
    const priority = parseInt(editForm.querySelector('.wi-edit-priority').value) || 0;

    if (!keys || !contentText) {
      alert('Keywords and content are required');
      return;
    }

    try {
      const keysArray = keys.split(',').map(k => k.trim()).filter(k => k);
      await invoke('update_world_info_entry', {
        characterId: currentCharacter.id,
        entryId: entry.id,
        keys: keysArray,
        content: contentText,
        enabled: entry.enabled,
        priority,
        caseSensitive: entry.case_sensitive
      });

      await loadRoleplaySettings();
    } catch (error) {
      console.error('Failed to update World Info entry:', error);
      alert(`Failed to update entry: ${error}`);
    }
  });
}

// Toggle World Info entry enabled state
async function handleToggleWorldInfoEntry(entryId, enabled) {
  if (!currentRoleplaySettings) return;

  const entry = currentRoleplaySettings.world_info.find(e => e.id === entryId);
  if (!entry) return;

  try {
    await invoke('update_world_info_entry', {
      characterId: currentCharacter.id,
      entryId: entryId,
      keys: entry.keys,
      content: entry.content,
      enabled: enabled,
      priority: entry.priority,
      caseSensitive: entry.case_sensitive
    });

    // Update local settings
    entry.enabled = enabled;

    // Update feature badges
    updateFeatureBadges();
  } catch (error) {
    console.error('Failed to toggle World Info entry:', error);
    alert(`Failed to toggle entry: ${error}`);
  }
}

// Delete World Info entry
async function handleDeleteWorldInfoEntry(entryId) {
  if (!confirm('Delete this World Info entry? This cannot be undone.')) return;

  try {
    await invoke('delete_world_info_entry', {
      characterId: currentCharacter.id,
      entryId: entryId
    });

    // Reload settings
    await loadRoleplaySettings();
  } catch (error) {
    console.error('Failed to delete World Info entry:', error);
    alert(`Failed to delete entry: ${error}`);
  }
}

// Import World Info
async function handleImportWorldInfo() {
  console.log('handleImportWorldInfo called');

  if (!currentCharacter) {
    await window.__TAURI__.dialog.message('Please select a character first');
    return;
  }

  // Ask user if they want to merge or replace
  const merge = await window.__TAURI__.dialog.confirm('Merge with existing entries?\n\nClick OK to merge, or Cancel to replace all existing entries.');

  console.log('User selected merge:', merge);

  try {
    console.log('Calling import_world_info...');
    const entryCount = await invoke('import_world_info', {
      characterId: currentCharacter.id,
      merge: merge
    });

    console.log('Import successful, count:', entryCount);
    await window.__TAURI__.dialog.message(`Successfully imported ${entryCount} World Info ${entryCount === 1 ? 'entry' : 'entries'}`);

    // Reload settings to show imported entries
    await loadRoleplaySettings();
  } catch (error) {
    console.error('Failed to import World Info:', error);
    if (error !== 'No file selected') {
      await window.__TAURI__.dialog.message(`Failed to import World Info: ${error}`);
    }
  }
}

// Export World Info
async function handleExportWorldInfo() {
  if (!currentCharacter) {
    await window.__TAURI__.dialog.message('Please select a character first');
    return;
  }

  // Ask user which format to export
  const useSillyTavern = await window.__TAURI__.dialog.confirm('Export format:\n\nClick OK for SillyTavern format\nClick Cancel for Claudia native format');
  const format = useSillyTavern ? 'sillytavern' : 'native';

  try {
    const outputPath = await invoke('export_world_info', {
      characterId: currentCharacter.id,
      format: format
    });

    await window.__TAURI__.dialog.message(`World Info exported successfully to:\n${outputPath}`);
  } catch (error) {
    console.error('Failed to export World Info:', error);
    if (error !== 'Save cancelled') {
      await window.__TAURI__.dialog.message(`Failed to export World Info: ${error}`);
    }
  }
}

// Save Author's Note
async function handleSaveAuthorsNote() {
  if (!currentCharacter) return;

  const content = document.getElementById('authors-note-text').value.trim() || null;
  const enabled = document.getElementById('authors-note-enabled').checked;

  try {
    await invoke('update_authors_note', {
      characterId: currentCharacter.id,
      content,
      enabled
    });

    // Update currentRoleplaySettings
    if (currentRoleplaySettings) {
      currentRoleplaySettings.authors_note = content;
      currentRoleplaySettings.authors_note_enabled = enabled;
    }

    // Update feature badges
    updateFeatureBadges();

    // Show success message
    showSuccess('Author\'s Note Saved', 'Your author\'s note has been saved successfully.');
  } catch (error) {
    console.error('Failed to save Author\'s Note:', error);
    showError('Save Failed', `Failed to save author's note: ${error}`);
  }
}

// Save Persona
async function handleSavePersona() {
  if (!currentCharacter) return;

  const name = document.getElementById('persona-name').value.trim() || null;
  const description = document.getElementById('persona-description').value.trim() || null;
  const enabled = document.getElementById('persona-enabled').checked;

  try {
    await invoke('update_persona', {
      characterId: currentCharacter.id,
      name,
      description,
      enabled
    });

    // Update currentRoleplaySettings
    if (currentRoleplaySettings) {
      currentRoleplaySettings.persona_name = name;
      currentRoleplaySettings.persona_description = description;
      currentRoleplaySettings.persona_enabled = enabled;
    }

    // Update feature badges
    updateFeatureBadges();

    // Show success message
    showSuccess('Persona Saved', 'Your persona has been saved successfully.');
  } catch (error) {
    console.error('Failed to save Persona:', error);
    showError('Save Failed', `Failed to save persona: ${error}`);
  }
}

// Save Message Examples Settings
async function handleSaveExamples() {
  if (!currentCharacter) return;

  const enabled = document.getElementById('examples-enabled').checked;
  const position = document.getElementById('examples-position').value;

  try {
    await invoke('update_examples_settings', {
      characterId: currentCharacter.id,
      enabled,
      position
    });

    // Update currentRoleplaySettings
    if (currentRoleplaySettings) {
      currentRoleplaySettings.examples_enabled = enabled;
      currentRoleplaySettings.examples_position = position;
    }

    // Update feature badges
    updateFeatureBadges();

    // Show success message
    showSuccess('Examples Saved', 'Message examples settings have been saved.');
  } catch (error) {
    console.error('Failed to save Message Examples settings:', error);
    showError('Save Failed', `Failed to save message examples settings: ${error}`);
  }
}

// Refresh Prompt Stack Preview
async function refreshPromptPreview() {
  const previewDiv = document.getElementById('prompt-stack-preview');
  previewDiv.innerHTML = '<span style="color: var(--text-secondary); font-style: italic;">Loading...</span>';

  try {
    let preview = '';
    let sectionNumber = 1;

    // Helper function to add a section
    const addSection = (title, content, enabled = true) => {
      if (!content || content.trim() === '') return '';
      if (!enabled) return `\n${'─'.repeat(60)}\n${sectionNumber++}. ${title} (DISABLED)\n${'─'.repeat(60)}\n\n`;
      return `\n${'─'.repeat(60)}\n${sectionNumber++}. ${title}\n${'─'.repeat(60)}\n${content}\n`;
    };

    preview += '═'.repeat(60) + '\n';
    preview += '  FINAL PROMPT ASSEMBLY ORDER\n';
    preview += '═'.repeat(60);

    // 1. System Prompt
    const systemPrompt = document.getElementById('character-system-prompt').value.trim();
    preview += addSection('SYSTEM PROMPT (Base Character Instructions)', systemPrompt);

    // 2. Message Examples (position: after_system)
    const examplesEnabled = document.getElementById('examples-enabled').checked;
    const examplesPosition = document.getElementById('examples-position').value;
    const mesExample = document.getElementById('character-mes-example').value.trim();

    if (examplesPosition === 'after_system' && mesExample) {
      preview += addSection('MESSAGE EXAMPLES (Teaching Character Voice)', mesExample, examplesEnabled);
    }

    // 3. Persona (if enabled)
    if (currentRoleplaySettings) {
      const personaEnabled = currentRoleplaySettings.persona_enabled;
      const personaName = currentRoleplaySettings.persona_name;
      const personaDesc = currentRoleplaySettings.persona_description;
      if (personaName || personaDesc) {
        const personaText = `User Character: ${personaName}\n${personaDesc}`;
        preview += addSection('PERSONA (User Character Definition)', personaText, personaEnabled);
      }
    }

    // 4. World Info note
    preview += `\n${'─'.repeat(60)}\n${sectionNumber++}. WORLD INFO ENTRIES\n${'─'.repeat(60)}\n`;
    preview += '[Injected dynamically when keywords are found in messages]\n';

    // 5. Chat History
    preview += `\n${'─'.repeat(60)}\n${sectionNumber++}. CHAT HISTORY\n${'─'.repeat(60)}\n`;
    preview += '[Your conversation messages appear here]\n';

    // 6. Post-History Instructions
    const postHistory = document.getElementById('character-post-history').value.trim();
    if (postHistory) {
      preview += addSection('POST-HISTORY INSTRUCTIONS', postHistory);
    }

    // 7. Author's Note
    if (currentRoleplaySettings) {
      const authorsNoteEnabled = currentRoleplaySettings.authors_note_enabled;
      const authorsNote = currentRoleplaySettings.authors_note;
      if (authorsNote) {
        preview += addSection("AUTHOR'S NOTE (Narrative Direction)", authorsNote.trim(), authorsNoteEnabled);
      }
    }

    // 8. Message Examples (position: before_history) - rare but possible
    if (examplesPosition === 'before_history' && mesExample) {
      preview += addSection('MESSAGE EXAMPLES (Before History Position)', mesExample, examplesEnabled);
    }

    // 9. Latest Messages
    preview += `\n${'─'.repeat(60)}\n${sectionNumber++}. LATEST MESSAGES (Recent Context)\n${'─'.repeat(60)}\n`;
    preview += '[Most recent messages for immediate context]\n';

    preview += '\n' + '═'.repeat(60);
    preview += '\n  END OF PROMPT ASSEMBLY\n';
    preview += '═'.repeat(60);

    previewDiv.innerHTML = `<pre style="margin: 0; color: var(--text-primary);">${preview}</pre>`;
  } catch (error) {
    console.error('Failed to generate prompt preview:', error);
    previewDiv.innerHTML = `<span style="color: var(--danger);">Error generating preview: ${error}</span>`;
  }
}

// Handle recursion depth change
async function handleRecursionDepthChange() {
  if (!currentCharacter) return;

  const depth = parseInt(document.getElementById('recursion-depth').value) || 3;

  try {
    await invoke('update_recursion_depth', {
      characterId: currentCharacter.id,
      depth
    });

    console.log('Recursion depth updated to:', depth);
  } catch (error) {
    console.error('Failed to update recursion depth:', error);
    setStatus('Failed to save recursion depth', 'error');
    setTimeout(() => setStatus('Ready'), 2000);
  }
}

// Prompt Preset Management

// Load available presets
async function loadPresets() {
  try {
    const presets = await invoke('get_presets');
    const presetSelect = document.getElementById('preset-select');

    // Clear existing options except "No Preset"
    presetSelect.innerHTML = '<option value="">No Preset</option>';

    // Add presets to dropdown
    presets.forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      presetSelect.appendChild(option);
    });

    // Set current preset if one is active
    if (currentRoleplaySettings && currentRoleplaySettings.active_preset_id) {
      presetSelect.value = currentRoleplaySettings.active_preset_id;
      await handlePresetSelect(currentRoleplaySettings.active_preset_id);
    } else {
      presetSelect.value = '';
      hidePresetInfo();
    }
  } catch (error) {
    console.error('Failed to load presets:', error);
  }
}

// Hide preset info panel
function hidePresetInfo() {
  const presetInfo = document.getElementById('preset-info');
  const applyBtn = document.getElementById('apply-preset-btn');
  presetInfo.style.display = 'none';
  applyBtn.disabled = true;
}

// Global variable to track current preset being edited
let currentEditingPreset = null;

// Show preset details/editor
async function handlePresetSelect(presetId) {
  if (!presetId) {
    hidePresetInfo();
    return;
  }

  try {
    const preset = await invoke('get_preset', { presetId });
    currentEditingPreset = preset;

    // Determine if this is a built-in preset
    const builtInIds = ['default', 'roleplay', 'creative-writing', 'assistant'];
    const isBuiltIn = builtInIds.includes(preset.id);

    // Show preset info
    const presetInfo = document.getElementById('preset-info');
    const presetName = document.getElementById('preset-name');
    const presetDescription = document.getElementById('preset-description');
    const builtInBadge = document.getElementById('preset-builtin-badge');
    const deleteBtn = document.getElementById('delete-preset-btn');
    const duplicateBtn = document.getElementById('duplicate-preset-btn');
    const saveChangesBtn = document.getElementById('save-preset-changes-btn');
    const addInstructionBtn = document.getElementById('add-instruction-btn');
    const applyBtn = document.getElementById('apply-preset-btn');

    // System additions elements
    const systemReadonly = document.getElementById('preset-system-readonly');
    const systemEditable = document.getElementById('preset-system-editable');

    // Author's note elements
    const authorsNoteReadonly = document.getElementById('preset-authors-note-readonly');
    const authorsNoteEditable = document.getElementById('preset-authors-note-editable');

    presetName.textContent = preset.name;
    presetDescription.textContent = preset.description;
    presetInfo.style.display = 'block';

    // Check if built-in preset is modified
    const modifiedBadge = document.getElementById('preset-modified-badge');
    const restoreBtn = document.getElementById('restore-preset-btn');
    let isModified = false;

    if (isBuiltIn) {
      isModified = await invoke('is_builtin_preset_modified', { presetId: preset.id });
    }

    // Show/hide built-in badge and controls
    if (isBuiltIn) {
      builtInBadge.style.display = 'inline-block';
      modifiedBadge.style.display = isModified ? 'inline-block' : 'none';
      deleteBtn.style.display = 'none';
      duplicateBtn.style.display = 'inline-block';
      restoreBtn.style.display = isModified ? 'inline-block' : 'none';
      saveChangesBtn.style.display = 'inline-block';
      addInstructionBtn.style.display = 'inline-block';

      // Show editable versions (built-in presets are now editable)
      systemEditable.value = preset.system_additions || '';
      systemEditable.style.display = 'block';
      systemReadonly.style.display = 'none';

      authorsNoteEditable.value = preset.authors_note_default || '';
      authorsNoteEditable.style.display = 'block';
      authorsNoteReadonly.style.display = 'none';
    } else {
      builtInBadge.style.display = 'none';
      modifiedBadge.style.display = 'none';
      restoreBtn.style.display = 'none';
      deleteBtn.style.display = 'inline-block';
      duplicateBtn.style.display = 'none';
      saveChangesBtn.style.display = 'block';
      addInstructionBtn.style.display = 'inline-block';

      // Show editable versions
      systemEditable.value = preset.system_additions || '';
      systemEditable.style.display = 'block';
      systemReadonly.style.display = 'none';

      authorsNoteEditable.value = preset.authors_note_default || '';
      authorsNoteEditable.style.display = 'block';
      authorsNoteReadonly.style.display = 'none';
    }

    // Render instruction blocks (all presets are now editable)
    renderInstructionBlocks(preset.instructions, false);

    // Enable apply button
    applyBtn.disabled = false;
  } catch (error) {
    console.error('Failed to load preset details:', error);
    hidePresetInfo();
  }
}

// Apply selected preset
async function handleApplyPreset() {
  if (!currentCharacter) return;

  const presetSelect = document.getElementById('preset-select');
  const presetId = presetSelect.value || null;

  try {
    await invoke('set_active_preset', {
      characterId: currentCharacter.id,
      presetId
    });

    // Update local settings
    if (currentRoleplaySettings) {
      currentRoleplaySettings.active_preset_id = presetId;
    }

    // Update feature badges
    updateFeatureBadges();

    setStatus(presetId ? 'Preset applied' : 'Preset removed', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to apply preset:', error);
    setStatus('Failed to apply preset', 'error');
    setTimeout(() => setStatus('Ready'), 2000);
  }
}

// Create custom preset
async function handleCreatePreset() {
  // Check if form already exists
  if (document.getElementById('preset-create-form')) return;

  const container = document.getElementById('presets-tab').querySelector('.roleplay-content');
  const createBtn = document.getElementById('create-preset-btn');

  // Create inline form
  const formDiv = document.createElement('div');
  formDiv.id = 'preset-create-form';
  formDiv.style.background = 'var(--bg-secondary)';
  formDiv.style.border = '2px solid var(--accent)';
  formDiv.style.borderRadius = '8px';
  formDiv.style.padding = '16px';
  formDiv.style.marginBottom = '16px';

  formDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Create Custom Preset</div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Name *</label>
        <input type="text" id="preset-create-name" placeholder="My Custom Preset" style="width: 100%;" />
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Description *</label>
        <textarea id="preset-create-desc" placeholder="What this preset does..." rows="3" style="width: 100%;"></textarea>
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">System Additions (optional)</label>
        <textarea id="preset-create-system" placeholder="Additional text to prepend to system prompt..." rows="3" style="width: 100%;"></textarea>
      </div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Default Author's Note (optional)</label>
        <textarea id="preset-create-note" placeholder="Default Author's Note if user hasn't set one..." rows="3" style="width: 100%;"></textarea>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn" id="preset-create-cancel">Cancel</button>
        <button type="button" class="worldinfo-btn" id="preset-create-save" style="background: var(--accent); color: white;">Create</button>
      </div>
    </div>
  `;

  container.insertBefore(formDiv, createBtn);
  document.getElementById('preset-create-name').focus();

  // Handle cancel
  document.getElementById('preset-create-cancel').addEventListener('click', () => {
    formDiv.remove();
  });

  // Handle save
  document.getElementById('preset-create-save').addEventListener('click', async () => {
    const name = document.getElementById('preset-create-name').value.trim();
    const description = document.getElementById('preset-create-desc').value.trim();
    const systemAdditions = document.getElementById('preset-create-system').value.trim();
    const authorsNoteDefault = document.getElementById('preset-create-note').value.trim();

    if (!name || !description) {
      alert('Name and description are required');
      return;
    }

    try {
      // Generate a simple ID from the name
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      const preset = {
        id: id,
        name,
        description,
        system_additions: systemAdditions || '',
        authors_note_default: authorsNoteDefault || '',
        instructions: [],
        format_hints: {
          wi_format: '[{content}]',
          scenario_format: '[Scenario: {content}]',
          personality_format: '[{char}\'s personality: {content}]'
        }
      };

      await invoke('save_custom_preset', { preset });

      formDiv.remove();
      setStatus('Custom preset created', 'success');
      setTimeout(() => setStatus('Ready'), 2000);

      // Reload presets
      await loadPresets();

      // Select the new preset
      document.getElementById('preset-select').value = id;
      await handlePresetSelect(id);
    } catch (error) {
      console.error('Failed to create preset:', error);
      alert(`Failed to create preset: ${error}`);
      setStatus('Failed to create preset', 'error');
      setTimeout(() => setStatus('Ready'), 2000);
    }
  });
}

// Render instruction blocks list
function renderInstructionBlocks(instructions, isReadOnly) {
  const listContainer = document.getElementById('preset-instructions-list');
  listContainer.innerHTML = '';

  if (!instructions || instructions.length === 0) {
    listContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); font-size: 11px; padding: 12px;">No instruction blocks yet.</div>';
    return;
  }

  // Sort by order
  const sortedInstructions = [...instructions].sort((a, b) => a.order - b.order);

  sortedInstructions.forEach((instruction, index) => {
    const blockDiv = document.createElement('div');
    blockDiv.className = 'worldinfo-entry';
    blockDiv.style.marginBottom = '8px';
    blockDiv.style.padding = '8px';
    blockDiv.style.background = 'var(--bg-secondary)';
    blockDiv.style.borderRadius = '4px';
    blockDiv.style.cursor = 'pointer';
    blockDiv.style.transition = 'all 0.2s ease';
    blockDiv.dataset.instructionId = instruction.id;
    blockDiv.dataset.collapsed = 'false';

    // Enable drag and drop for non-readonly
    if (!isReadOnly) {
      blockDiv.draggable = true;
      blockDiv.style.cursor = 'move';

      // Drag event handlers
      blockDiv.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', instruction.id);
        blockDiv.style.opacity = '0.5';
      });

      blockDiv.addEventListener('dragend', (e) => {
        blockDiv.style.opacity = '1';
        // Remove all drop indicators
        document.querySelectorAll('.worldinfo-entry').forEach(el => {
          el.style.borderTop = '';
          el.style.borderBottom = '';
        });
      });

      blockDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Show drop indicator
        const rect = blockDiv.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          blockDiv.style.borderTop = '2px solid var(--accent)';
          blockDiv.style.borderBottom = '';
        } else {
          blockDiv.style.borderTop = '';
          blockDiv.style.borderBottom = '2px solid var(--accent)';
        }
      });

      blockDiv.addEventListener('dragleave', (e) => {
        blockDiv.style.borderTop = '';
        blockDiv.style.borderBottom = '';
      });

      blockDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        blockDiv.style.borderTop = '';
        blockDiv.style.borderBottom = '';

        const draggedId = e.dataTransfer.getData('text/plain');
        const draggedInstruction = currentEditingPreset.instructions.find(i => i.id === draggedId);
        const dropInstruction = instruction;

        if (draggedId !== instruction.id && draggedInstruction) {
          // Determine drop position
          const rect = blockDiv.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          const dropBefore = e.clientY < midpoint;

          // Reorder instructions
          const draggedOrder = draggedInstruction.order;
          const dropOrder = dropInstruction.order;

          if (dropBefore) {
            // Insert before
            if (draggedOrder < dropOrder) {
              // Moving down - shift items between draggedOrder and dropOrder-1 up
              currentEditingPreset.instructions.forEach(inst => {
                if (inst.order > draggedOrder && inst.order < dropOrder) {
                  inst.order--;
                }
              });
              draggedInstruction.order = dropOrder - 1;
            } else {
              // Moving up - shift items from dropOrder to draggedOrder-1 down
              currentEditingPreset.instructions.forEach(inst => {
                if (inst.order >= dropOrder && inst.order < draggedOrder) {
                  inst.order++;
                }
              });
              draggedInstruction.order = dropOrder;
            }
          } else {
            // Insert after
            if (draggedOrder < dropOrder) {
              // Moving down - shift items between draggedOrder+1 and dropOrder down
              currentEditingPreset.instructions.forEach(inst => {
                if (inst.order > draggedOrder && inst.order <= dropOrder) {
                  inst.order--;
                }
              });
              draggedInstruction.order = dropOrder;
            } else {
              // Moving up - shift items from dropOrder+1 to draggedOrder-1 down
              currentEditingPreset.instructions.forEach(inst => {
                if (inst.order > dropOrder && inst.order < draggedOrder) {
                  inst.order++;
                }
              });
              draggedInstruction.order = dropOrder + 1;
            }
          }

          // Re-render
          renderInstructionBlocks(currentEditingPreset.instructions, isReadOnly);
        }
      });
    }

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '6px';
    header.style.userSelect = 'none';

    const leftSide = document.createElement('div');
    leftSide.style.display = 'flex';
    leftSide.style.alignItems = 'center';
    leftSide.style.gap = '8px';

    // Expand/collapse chevron
    const chevron = document.createElement('span');
    chevron.style.fontSize = '10px';
    chevron.style.transition = 'transform 0.2s ease';
    chevron.textContent = '▼';
    chevron.style.color = 'var(--text-secondary)';
    leftSide.appendChild(chevron);

    if (!isReadOnly) {
      // Drag handle
      const dragHandle = document.createElement('span');
      dragHandle.style.fontSize = '10px';
      dragHandle.style.color = 'var(--text-secondary)';
      dragHandle.textContent = '⋮⋮';
      dragHandle.style.cursor = 'move';
      leftSide.appendChild(dragHandle);

      // Checkbox for enabled/disabled
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = instruction.enabled;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        instruction.enabled = checkbox.checked;
      });
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      leftSide.appendChild(checkbox);
    }

    // Order badge
    const orderBadge = document.createElement('span');
    orderBadge.style.fontSize = '10px';
    orderBadge.style.color = 'var(--text-secondary)';
    orderBadge.style.background = 'var(--bg-primary)';
    orderBadge.style.padding = '2px 6px';
    orderBadge.style.borderRadius = '3px';
    orderBadge.textContent = `#${instruction.order}`;
    leftSide.appendChild(orderBadge);

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '500';
    nameSpan.style.fontSize = '11px';
    nameSpan.textContent = instruction.name;
    if (!instruction.enabled) {
      nameSpan.style.opacity = '0.5';
    }
    leftSide.appendChild(nameSpan);

    header.appendChild(leftSide);

    if (!isReadOnly) {
      // Control buttons
      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '4px';

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'worldinfo-btn';
      editBtn.textContent = 'Edit';
      editBtn.style.fontSize = '11px';
      editBtn.style.padding = '2px 6px';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editInstruction(instruction);
      });
      controls.appendChild(editBtn);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'worldinfo-btn worldinfo-btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.fontSize = '11px';
      deleteBtn.style.padding = '2px 6px';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteInstruction(instruction.id);
      });
      controls.appendChild(deleteBtn);

      header.appendChild(controls);
    }

    // Content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'instruction-content';
    contentDiv.style.fontSize = '11px';
    contentDiv.style.color = 'var(--text-secondary)';
    contentDiv.style.marginTop = '4px';
    contentDiv.style.whiteSpace = 'pre-wrap';
    contentDiv.style.overflow = 'hidden';
    contentDiv.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
    contentDiv.textContent = instruction.content;
    if (!instruction.enabled) {
      contentDiv.style.opacity = '0.5';
    }

    // Toggle expand/collapse on header click
    header.addEventListener('click', () => {
      const isCollapsed = blockDiv.dataset.collapsed === 'true';
      blockDiv.dataset.collapsed = isCollapsed ? 'false' : 'true';

      if (isCollapsed) {
        // Expand
        chevron.style.transform = 'rotate(0deg)';
        contentDiv.style.maxHeight = contentDiv.scrollHeight + 'px';
        contentDiv.style.opacity = '1';
        setTimeout(() => {
          contentDiv.style.maxHeight = 'none';
        }, 300);
      } else {
        // Collapse
        chevron.style.transform = 'rotate(-90deg)';
        contentDiv.style.maxHeight = contentDiv.scrollHeight + 'px';
        setTimeout(() => {
          contentDiv.style.maxHeight = '0';
          contentDiv.style.opacity = '0';
        }, 10);
      }
    });

    blockDiv.appendChild(header);
    blockDiv.appendChild(contentDiv);
    listContainer.appendChild(blockDiv);
  });
}

// Add new instruction block
function addInstructionBlock() {
  if (!currentEditingPreset) return;

  const listContainer = document.getElementById('preset-instructions-list');

  // Check if form already exists
  if (document.getElementById('instruction-add-form')) return;

  // Create inline form
  const formDiv = document.createElement('div');
  formDiv.id = 'instruction-add-form';
  formDiv.style.background = 'var(--bg-secondary)';
  formDiv.style.border = '2px solid var(--accent)';
  formDiv.style.borderRadius = '6px';
  formDiv.style.padding = '12px';
  formDiv.style.marginBottom = '8px';

  formDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="font-weight: 500; font-size: 11px; color: var(--text-primary);">Add Instruction Block</div>
      <div>
        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Name</label>
        <input type="text" id="inst-add-name" placeholder="Block name..." style="width: 100%; padding: 6px; font-size: 11px;" />
      </div>
      <div>
        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Content</label>
        <textarea id="inst-add-content" placeholder="Instruction content..." rows="4" style="width: 100%; padding: 6px; font-size: 11px;"></textarea>
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn" id="inst-add-cancel" style="font-size: 11px; padding: 4px 8px;">Cancel</button>
        <button type="button" class="worldinfo-btn" id="inst-add-save" style="background: var(--accent); color: white; font-size: 11px; padding: 4px 8px;">Add</button>
      </div>
    </div>
  `;

  listContainer.prepend(formDiv);
  document.getElementById('inst-add-name').focus();

  // Handle cancel
  document.getElementById('inst-add-cancel').addEventListener('click', () => {
    formDiv.remove();
  });

  // Handle save
  document.getElementById('inst-add-save').addEventListener('click', () => {
    const name = document.getElementById('inst-add-name').value.trim();
    const content = document.getElementById('inst-add-content').value.trim();

    if (!name || !content) {
      alert('Name and content are required');
      return;
    }

    // Generate ID and determine order
    const id = `inst_${Date.now()}`;
    const maxOrder = currentEditingPreset.instructions.length > 0
      ? Math.max(...currentEditingPreset.instructions.map(i => i.order))
      : 0;

    const newInstruction = {
      id,
      name,
      content,
      enabled: true,
      order: maxOrder + 1
    };

    currentEditingPreset.instructions.push(newInstruction);
    formDiv.remove();

    // Re-render
    renderInstructionBlocks(currentEditingPreset.instructions, false);
  });
}

// Edit instruction block
function editInstruction(instruction) {
  // Find the instruction block div
  const listContainer = document.getElementById('preset-instructions-list');
  const blocks = Array.from(listContainer.children);
  const blockDiv = blocks.find(el => {
    const header = el.querySelector('[style*="cursor: pointer"]');
    return header && header.textContent.includes(instruction.name);
  });

  if (!blockDiv) return;

  // Check if already editing
  if (blockDiv.querySelector('.instruction-edit-form')) return;

  // Hide original content
  const header = blockDiv.querySelector('[style*="cursor: pointer"]');
  const content = blockDiv.querySelector('.instruction-content');
  header.style.display = 'none';
  content.style.display = 'none';

  // Create edit form
  const editForm = document.createElement('div');
  editForm.className = 'instruction-edit-form';
  editForm.style.padding = '8px';
  editForm.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="font-weight: 500; font-size: 11px; color: var(--text-primary);">Edit Instruction Block</div>
      <div>
        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Name</label>
        <input type="text" class="inst-edit-name" value="${instruction.name}" style="width: 100%; padding: 6px; font-size: 11px;" />
      </div>
      <div>
        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Content</label>
        <textarea class="inst-edit-content" rows="4" style="width: 100%; padding: 6px; font-size: 11px;">${instruction.content}</textarea>
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn inst-edit-cancel" style="font-size: 11px; padding: 4px 8px;">Cancel</button>
        <button type="button" class="worldinfo-btn inst-edit-save" style="background: var(--accent); color: white; font-size: 11px; padding: 4px 8px;">Save</button>
      </div>
    </div>
  `;

  blockDiv.appendChild(editForm);
  editForm.querySelector('.inst-edit-name').focus();

  // Handle cancel
  editForm.querySelector('.inst-edit-cancel').addEventListener('click', () => {
    header.style.display = '';
    content.style.display = '';
    editForm.remove();
  });

  // Handle save
  editForm.querySelector('.inst-edit-save').addEventListener('click', () => {
    const newName = editForm.querySelector('.inst-edit-name').value.trim();
    const newContent = editForm.querySelector('.inst-edit-content').value.trim();

    if (!newName || !newContent) {
      alert('Name and content are required');
      return;
    }

    instruction.name = newName;
    instruction.content = newContent;

    // Re-render
    renderInstructionBlocks(currentEditingPreset.instructions, false);
  });
}

// Delete instruction block
function deleteInstruction(instructionId) {
  if (!confirm('Delete this instruction block?')) return;

  if (!currentEditingPreset) return;

  currentEditingPreset.instructions = currentEditingPreset.instructions.filter(
    i => i.id !== instructionId
  );

  // Re-render
  renderInstructionBlocks(currentEditingPreset.instructions, false);
}

// Move instruction block up or down
function moveInstruction(instructionId, direction) {
  if (!currentEditingPreset) return;

  const instructions = currentEditingPreset.instructions.sort((a, b) => a.order - b.order);
  const index = instructions.findIndex(i => i.id === instructionId);

  if (index === -1) return;
  if (direction === -1 && index === 0) return; // Already at top
  if (direction === 1 && index === instructions.length - 1) return; // Already at bottom

  const targetIndex = index + direction;

  // Swap orders
  const temp = instructions[index].order;
  instructions[index].order = instructions[targetIndex].order;
  instructions[targetIndex].order = temp;

  // Re-render
  renderInstructionBlocks(currentEditingPreset.instructions, false);
}

// Save preset changes
async function savePresetChanges() {
  if (!currentEditingPreset) return;

  try {
    // Update system additions and author's note from UI
    const systemEditable = document.getElementById('preset-system-editable');
    const authorsNoteEditable = document.getElementById('preset-authors-note-editable');

    currentEditingPreset.system_additions = systemEditable.value;
    currentEditingPreset.authors_note_default = authorsNoteEditable.value;

    // Save via update_preset_instructions command
    await invoke('update_preset_instructions', {
      presetId: currentEditingPreset.id,
      instructions: currentEditingPreset.instructions
    });

    // Also save the full preset to update system_additions and authors_note_default
    await invoke('save_custom_preset', { preset: currentEditingPreset });

    setStatus('Preset saved', 'success');
    setTimeout(() => setStatus('Ready'), 2000);

    // Reload to show updated preset
    await handlePresetSelect(currentEditingPreset.id);
  } catch (error) {
    console.error('Failed to save preset changes:', error);
    alert(`Failed to save changes: ${error}`);
    setStatus('Failed to save preset', 'error');
    setTimeout(() => setStatus('Ready'), 2000);
  }
}

// Delete custom preset
async function deletePreset() {
  if (!currentEditingPreset) return;

  if (!confirm(`Delete preset "${currentEditingPreset.name}"? This cannot be undone.`)) return;

  try {
    await invoke('delete_custom_preset', { presetId: currentEditingPreset.id });

    setStatus('Preset deleted', 'success');
    setTimeout(() => setStatus('Ready'), 2000);

    // Clear selection and reload presets
    document.getElementById('preset-select').value = '';
    currentEditingPreset = null;
    hidePresetInfo();
    await loadPresets();
  } catch (error) {
    console.error('Failed to delete preset:', error);
    alert(`Failed to delete preset: ${error}`);
    setStatus('Failed to delete preset', 'error');
    setTimeout(() => setStatus('Ready'), 2000);
  }
}

// Duplicate preset (create editable copy)
async function duplicatePreset() {
  if (!currentEditingPreset) return;

  // Check if form already exists
  if (document.getElementById('preset-duplicate-form')) return;

  const presetInfo = document.getElementById('preset-info');
  const formDiv = document.createElement('div');
  formDiv.id = 'preset-duplicate-form';
  formDiv.style.background = 'var(--bg-secondary)';
  formDiv.style.border = '2px solid var(--accent)';
  formDiv.style.borderRadius = '8px';
  formDiv.style.padding = '16px';
  formDiv.style.marginBottom = '16px';

  formDiv.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Duplicate Preset</div>
      <div>
        <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">New Preset Name *</label>
        <input type="text" id="preset-duplicate-name" placeholder="My Preset (Copy)" value="${currentEditingPreset.name} (Copy)" style="width: 100%;" />
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="worldinfo-btn" id="preset-duplicate-cancel">Cancel</button>
        <button type="button" class="worldinfo-btn" id="preset-duplicate-save" style="background: var(--accent); color: white;">Duplicate</button>
      </div>
    </div>
  `;

  presetInfo.parentNode.insertBefore(formDiv, presetInfo.nextSibling);
  document.getElementById('preset-duplicate-name').focus();
  document.getElementById('preset-duplicate-name').select();

  // Cancel button
  document.getElementById('preset-duplicate-cancel').addEventListener('click', () => {
    formDiv.remove();
  });

  // Duplicate button
  document.getElementById('preset-duplicate-save').addEventListener('click', async () => {
    const newName = document.getElementById('preset-duplicate-name').value.trim();
    if (!newName) {
      alert('Please enter a preset name');
      return;
    }

    try {
      const duplicatedPreset = await invoke('duplicate_preset', {
        sourcePresetId: currentEditingPreset.id,
        newName: newName
      });

      setStatus('Preset duplicated successfully', 'success');
      setTimeout(() => setStatus('Ready'), 2000);

      // Remove form
      formDiv.remove();

      // Reload presets
      await loadPresets();

      // Select the new preset
      document.getElementById('preset-select').value = duplicatedPreset.id;
      await handlePresetSelect(duplicatedPreset.id);
    } catch (error) {
      console.error('Failed to duplicate preset:', error);
      alert(`Failed to duplicate preset: ${error}`);
      setStatus('Failed to duplicate preset', 'error');
      setTimeout(() => setStatus('Ready'), 2000);
    }
  });
}

// Restore built-in preset to default
async function restoreBuiltinPreset() {
  if (!currentEditingPreset) return;

  const builtInIds = ['default', 'roleplay', 'creative-writing', 'assistant'];
  if (!builtInIds.includes(currentEditingPreset.id)) {
    alert('Can only restore built-in presets');
    return;
  }

  if (!confirm(`Are you sure you want to restore "${currentEditingPreset.name}" to its default settings? All your modifications will be lost.`)) {
    return;
  }

  try {
    const restoredPreset = await invoke('restore_builtin_preset', {
      presetId: currentEditingPreset.id
    });

    setStatus('Preset restored to default successfully', 'success');
    setTimeout(() => setStatus('Ready'), 2000);

    // Reload presets
    await loadPresets();

    // Re-select the restored preset to refresh the UI
    await handlePresetSelect(restoredPreset.id);
  } catch (error) {
    console.error('Failed to restore preset:', error);
    alert(`Failed to restore preset: ${error}`);
    setStatus('Failed to restore preset', 'error');
    setTimeout(() => setStatus('Ready'), 2000);
  }
}

// Load existing config if available
async function loadExistingConfig() {
  console.log('Loading existing config...');
  try {
    const config = await invoke('get_api_config');
    console.log('Loaded config:', config);
    document.getElementById('api-base-url').value = config.base_url;
    document.getElementById('api-key').value = config.api_key;
    document.getElementById('stream-toggle').checked = config.stream || false;
    document.getElementById('context-limit').value = config.context_limit || 200000;

    // Cache context limit to avoid repeated API calls
    cachedContextLimit = config.context_limit || 200000;

    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = ''; // Clear existing options
    const option = document.createElement('option');
    option.value = config.model;
    option.textContent = config.model;
    option.selected = true;
    modelSelect.appendChild(option);

    // Show the model group since we have a saved model
    document.getElementById('models-group').style.display = 'flex';
    document.getElementById('save-settings-btn').disabled = false;

    // Load characters
    await loadCharacters();
  } catch (error) {
    console.error('Failed to load existing config:', error);
    addMessage('API not configured. Please configure your API settings.', false);
    showSettings();
  } finally {
    // Hide loading overlay after initialization is complete
    // Ensure minimum display time of 800ms so users see the loading state
    const loadingOverlay = document.getElementById('app-loading');
    if (loadingOverlay) {
      const startTime = window.appStartTime || Date.now();
      const elapsed = Date.now() - startTime;
      const minDisplayTime = 800;
      const remainingTime = Math.max(0, minDisplayTime - elapsed);

      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
        // Remove from DOM after transition completes
        setTimeout(() => {
          loadingOverlay.remove();
        }, 300);
      }, remainingTime);
    }
  }
}

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  messageInput = document.getElementById('message-input');
  messagesContainer = document.getElementById('messages');
  chatForm = document.getElementById('chat-form');
  sendBtn = document.getElementById('send-btn');
  statusText = document.getElementById('status-text');
  settingsPanel = document.getElementById('settings-panel');
  chatView = document.getElementById('chat-view');
  characterSelect = document.getElementById('character-select');
  characterHeaderName = document.getElementById('character-header-name');
  newCharacterBtn = document.getElementById('new-character-btn');

  // Load and execute plugins
  (async () => {
    try {
      const pluginCode = await invoke('load_plugins');
      if (pluginCode) {
        console.log('Executing plugin code...');
        // Execute plugin code
        eval(pluginCode);
        console.log('Plugins loaded successfully');
        console.log('Plugin settings registry:', pluginSettingsRegistry);
        console.log('Registry keys:', Object.keys(pluginSettingsRegistry));
      }
    } catch (error) {
      console.error('Failed to load plugins:', error);
      showError('Plugin Error', 'Failed to load plugins: ' + error.message);
    }
  })();

  chatForm.addEventListener('submit', handleSubmit);
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);
  document.getElementById('character-form').addEventListener('submit', handleSaveCharacter);
  document.getElementById('validate-btn').addEventListener('click', handleValidate);

  // Edit character modal event listeners
  const editCharacterModal = document.getElementById('edit-character-modal');
  const editCharacterForm = document.getElementById('edit-character-form');
  const closeEditBtn = document.getElementById('close-edit-character-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-character-btn');
  const editOverlay = editCharacterModal.querySelector('.new-character-overlay');

  editCharacterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const characterId = document.getElementById('edit-character-id').value;
    const name = document.getElementById('edit-character-name').value.trim();
    const systemPrompt = document.getElementById('edit-character-system-prompt').value.trim();
    const greeting = document.getElementById('edit-character-greeting').value.trim() || null;
    const personality = document.getElementById('edit-character-personality').value.trim() || null;
    const description = document.getElementById('edit-character-description').value.trim() || null;
    const scenario = document.getElementById('edit-character-scenario').value.trim() || null;
    const mesExample = document.getElementById('edit-character-mes-example').value.trim() || null;

    // Extract advanced fields
    const postHistory = document.getElementById('edit-character-post-history').value.trim() || null;

    const altGreetingsText = document.getElementById('edit-character-alt-greetings').value.trim();
    const alternateGreetings = altGreetingsText
      ? altGreetingsText.split('\n').map(s => s.trim()).filter(s => s)
      : null;

    // Extract metadata fields
    const tagsText = document.getElementById('edit-character-tags').value.trim();
    const tags = tagsText
      ? tagsText.split(',').map(s => s.trim()).filter(s => s)
      : null;

    const creator = document.getElementById('edit-character-creator').value.trim() || null;
    const characterVersion = document.getElementById('edit-character-version').value.trim() || null;
    const creatorNotes = document.getElementById('edit-character-creator-notes').value.trim() || null;

    try {
      setStatus('Updating character...', 'default');
      await invoke('update_character', {
        characterId,
        name,
        systemPrompt,
        greeting,
        personality,
        description,
        scenario,
        mesExample,
        postHistory,
        alternateGreetings,
        tags,
        creator,
        creatorNotes,
        characterVersion
      });

      editCharacterModal.style.display = 'none';
      await loadCharacters();
      setStatus('Character updated', 'success');
      setTimeout(() => setStatus('Ready'), 2000);
    } catch (error) {
      console.error('Failed to update character:', error);
      setStatus('Failed to update character', 'error');
      await window.__TAURI__.dialog.message(`Failed to update character: ${error}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  });

  closeEditBtn.addEventListener('click', () => {
    editCharacterModal.style.display = 'none';
  });

  cancelEditBtn.addEventListener('click', () => {
    editCharacterModal.style.display = 'none';
  });

  editOverlay.addEventListener('click', () => {
    editCharacterModal.style.display = 'none';
  });

  // Edit modal expression handlers
  const editUploadExpressionBtn = document.getElementById('edit-upload-expression-btn');
  editUploadExpressionBtn.addEventListener('click', handleEditUploadExpression);

  const editDefaultExpressionSelect = document.getElementById('edit-default-expression-select');
  editDefaultExpressionSelect.addEventListener('change', async () => {
    const characterId = document.getElementById('edit-character-id').value;
    const expressionName = editDefaultExpressionSelect.value || null;

    try {
      await invoke('set_default_expression', { characterId, expressionName });
    } catch (error) {
      console.error('Failed to set default expression:', error);
      setStatus('Failed to set default expression', 'error');
    }
  });

  // Edit modal avatar handlers
  const editUploadAvatarBtn = document.getElementById('edit-upload-avatar-btn');
  const editRemoveAvatarBtn = document.getElementById('edit-remove-avatar-btn');

  editUploadAvatarBtn.addEventListener('click', async () => {
    try {
      const characterId = document.getElementById('edit-character-id').value;
      const avatarFilename = await invoke('select_and_upload_avatar', {
        characterId: characterId
      });

      // Update preview
      const avatarCircle = document.getElementById('edit-avatar-circle');
      const avatarUrl = await getAvatarUrl(avatarFilename);
      if (avatarUrl) {
        avatarCircle.style.backgroundImage = `url('${avatarUrl}')`;
        editRemoveAvatarBtn.style.display = 'inline-block';
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      // Don't show error if user just cancelled the dialog
      if (error && !error.toString().includes('No file selected')) {
        setStatus('Failed to upload avatar', 'error');
      }
    }
  });

  editRemoveAvatarBtn.addEventListener('click', async () => {
    try {
      const characterId = document.getElementById('edit-character-id').value;
      await invoke('remove_avatar', { characterId: characterId });

      // Update preview
      const avatarCircle = document.getElementById('edit-avatar-circle');
      avatarCircle.style.backgroundImage = '';
      editRemoveAvatarBtn.style.display = 'none';
    } catch (error) {
      console.error('Avatar remove error:', error);
      setStatus('Failed to remove avatar', 'error');
    }
  });

  setupAppControls();
  setupKeyboardShortcuts();
  setupTabs();

  // Avatar modal close handlers
  const avatarModal = document.getElementById('avatar-modal');
  const avatarModalOverlay = document.querySelector('.avatar-modal-overlay');

  avatarModalOverlay.addEventListener('click', hideAvatarModal);

  // ESC key to close modal
  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Handle command palette keydown (for arrow keys, enter, escape)
    handleCommandPaletteKeydown(e);

    // Escape key handling
    if (e.key === 'Escape') {
      // Close chat search
      if (chatSearchBar && chatSearchBar.style.display !== 'none') {
        closeChatSearch();
        return;
      }

      // Close new character modal
      const newCharacterModal = document.getElementById('new-character-modal');
      if (newCharacterModal && newCharacterModal.style.display !== 'none') {
        document.getElementById('cancel-new-character-btn').click();
        return;
      }

      // Close edit character modal
      const editCharModal = document.getElementById('edit-character-modal');
      if (editCharModal && editCharModal.style.display !== 'none') {
        editCharModal.style.display = 'none';
        return;
      }

      // Close avatar modal
      if (avatarModal.style.display !== 'none') {
        hideAvatarModal();
        return;
      }

      // Close roleplay panel
      const roleplayPanel = document.getElementById('roleplay-panel');
      if (roleplayPanel && roleplayPanel.classList.contains('active')) {
        document.getElementById('close-roleplay-btn').click();
        return;
      }

      // Close settings panel
      const settingsPanel = document.getElementById('settings-panel');
      if (settingsPanel && settingsPanel.classList.contains('active')) {
        document.getElementById('close-settings-btn').click();
        return;
      }

      // Cancel message editing
      const editActions = document.querySelector('.message-edit-actions');
      if (editActions) {
        const cancelBtn = editActions.querySelector('.message-edit-cancel');
        if (cancelBtn) cancelBtn.click();
        return;
      }
    }

    // Up Arrow - Edit last user message (when input is focused and empty/at start)
    if (e.key === 'ArrowUp' && e.target === messageInput && messageInput.selectionStart === 0) {
      const messages = document.querySelectorAll('.message.user');
      if (messages.length > 0) {
        const lastUserMessage = messages[messages.length - 1];
        const editBtn = lastUserMessage.querySelector('.message-action-btn[title="Edit message"]');
        if (editBtn) {
          e.preventDefault();
          editBtn.click();
        }
      }
      return;
    }

    // Left Arrow - Previous swipe (when not in input)
    if (e.key === 'ArrowLeft' && e.target !== messageInput && !e.target.matches('input, textarea, select')) {
      const lastAssistantMessage = [...document.querySelectorAll('.message.assistant')].pop();
      if (lastAssistantMessage) {
        const prevBtn = lastAssistantMessage.querySelector('.swipe-prev');
        if (prevBtn && !prevBtn.disabled) {
          e.preventDefault();
          prevBtn.click();
        }
      }
      return;
    }

    // Right Arrow - Next swipe (when not in input)
    if (e.key === 'ArrowRight' && e.target !== messageInput && !e.target.matches('input, textarea, select')) {
      const lastAssistantMessage = [...document.querySelectorAll('.message.assistant')].pop();
      if (lastAssistantMessage) {
        const nextBtn = lastAssistantMessage.querySelector('.swipe-next');
        if (nextBtn && !nextBtn.disabled) {
          e.preventDefault();
          nextBtn.click();
        }
      }
      return;
    }

    // Ctrl/Cmd + K - Focus message input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      messageInput.focus();
      return;
    }

    // Ctrl/Cmd + P - Open command palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    // Ctrl/Cmd + F - Open chat search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openChatSearch();
      return;
    }

    // Ctrl/Cmd + / - Toggle roleplay panel
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      document.getElementById('roleplay-btn').click();
      return;
    }

    // Ctrl/Cmd + ? - Open keyboard shortcuts help
    if ((e.ctrlKey || e.metaKey) && e.key === '?') {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    // Ctrl/Cmd + Z - Undo (only if not in input field to avoid conflicts with native undo)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !e.target.matches('input, textarea')) {
      e.preventDefault();
      performUndo();
      return;
    }

    // Ctrl/Cmd + Shift + Z - Redo (only if not in input field to avoid conflicts with native redo)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Z' && e.shiftKey && !e.target.matches('input, textarea')) {
      e.preventDefault();
      performRedo();
      return;
    }

    // Ctrl/Cmd + Enter - Send message (alternative to Enter)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target === messageInput) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }
  });

  messageInput.focus();
  setStatus('Ready');

  // Load saved preferences before anything else
  loadSavedTheme();
  loadSavedViewMode();
  loadSavedFontSize();
  loadSavedLayoutMode();
  loadSavedTimestampPreference();

  // Setup auto-save for message input
  setupAutoSave();

  // Setup drag and drop file handling
  setupDragAndDrop();

  // Setup chat search
  setupChatSearch();

  // Setup context menu
  setupContextMenu();

  // Setup settings search
  setupSettingsSearch();

  // Setup character filter and sort
  setupCharacterFilter();

  // Setup keyboard shortcuts modal
  setupShortcutsModal();

  loadExistingConfig();
});

// ============================================================================
// Empty States
// ============================================================================

function showEmptyState(container, options = {}) {
  const {
    icon = '💬',
    title = 'No data yet',
    description = 'Get started by adding something new.',
    actionText = null,
    actionCallback = null
  } = options;

  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';

  let actionHTML = '';
  if (actionText && actionCallback) {
    actionHTML = `
      <button class="empty-state-action">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        ${actionText}
      </button>
    `;
  }

  emptyState.innerHTML = `
    <div class="empty-state-icon">${icon}</div>
    <h3 class="empty-state-title">${title}</h3>
    <p class="empty-state-description">${description}</p>
    ${actionHTML}
  `;

  if (actionCallback) {
    const button = emptyState.querySelector('.empty-state-action');
    if (button) {
      button.addEventListener('click', actionCallback);
    }
  }

  if (typeof container === 'string') {
    const element = document.getElementById(container);
    if (element) {
      element.innerHTML = '';
      element.appendChild(emptyState);
    }
  } else if (container) {
    container.innerHTML = '';
    container.appendChild(emptyState);
  }
}

// ============================================================================
// Skeleton Loading Screens
// ============================================================================

function createSkeletonMessage() {
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton-message';
  skeleton.innerHTML = `
    <div class="skeleton skeleton-avatar"></div>
    <div class="skeleton-message-content">
      <div class="skeleton skeleton-line long"></div>
      <div class="skeleton skeleton-line medium"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>
  `;
  return skeleton;
}

function createSkeletonCharacterItem() {
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton-character-item';
  skeleton.innerHTML = `
    <div class="skeleton skeleton-character-avatar"></div>
    <div class="skeleton-character-info">
      <div class="skeleton skeleton-character-name"></div>
      <div class="skeleton skeleton-character-preview"></div>
    </div>
  `;
  return skeleton;
}

function showMessageSkeleton(count = 3) {
  const container = document.getElementById('messages');
  if (!container) return;

  // Clear existing content
  container.innerHTML = '';

  // Add skeleton messages
  for (let i = 0; i < count; i++) {
    container.appendChild(createSkeletonMessage());
  }
}

function showCharacterListSkeleton(count = 5) {
  const container = document.getElementById('sidebar-character-list');
  if (!container) return;

  // Clear existing content
  container.innerHTML = '';

  // Add skeleton character items
  for (let i = 0; i < count; i++) {
    container.appendChild(createSkeletonCharacterItem());
  }
}

function clearSkeleton(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove all skeleton elements
  container.querySelectorAll('.skeleton-message, .skeleton-character-item').forEach(el => {
    el.remove();
  });
}

// ============================================================================
// Keyboard Shortcuts Modal
// ============================================================================

function setupShortcutsModal() {
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsOverlay = shortcutsModal.querySelector('.shortcuts-overlay');
  const closeBtn = document.getElementById('shortcuts-close-btn');

  // Close shortcuts modal
  const closeShortcutsModal = () => {
    shortcutsModal.style.display = 'none';
  };

  // Overlay click
  shortcutsOverlay.addEventListener('click', closeShortcutsModal);

  // Close button click
  closeBtn.addEventListener('click', closeShortcutsModal);

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shortcutsModal.style.display !== 'none') {
      closeShortcutsModal();
    }
  });
}

function openShortcutsModal() {
  const shortcutsModal = document.getElementById('shortcuts-modal');
  shortcutsModal.style.display = 'flex';
}

// ============================================================================
// Expression System
// ============================================================================

async function loadExpressionsGallery(characterId) {
  try {
    const expressions = await invoke('get_character_expressions', { characterId });
    const gallery = document.getElementById('expressions-gallery');
    const defaultSelect = document.getElementById('default-expression-select');

    // Clear gallery
    gallery.innerHTML = '';

    // Clear and repopulate default expression select
    defaultSelect.innerHTML = '<option value="">None</option>';

    // Display each expression
    for (const [exprName, filename] of Object.entries(expressions)) {
      // Get full path to expression image
      const fullPath = await invoke('get_expression_full_path', {
        characterId,
        expressionFilename: filename
      });

      // Create expression item
      const item = document.createElement('div');
      item.className = 'expression-item';
      item.innerHTML = `
        <img src="${convertFileSrc(fullPath)}" alt="${exprName}" />
        <div class="expression-item-name">${exprName}</div>
        <button class="expression-item-delete" data-expr-name="${exprName}" title="Delete expression">×</button>
      `;

      // Add delete handler
      const deleteBtn = item.querySelector('.expression-item-delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDeleteExpression(characterId, exprName);
      });

      gallery.appendChild(item);

      // Add to default expression select
      const option = document.createElement('option');
      option.value = exprName;
      option.textContent = exprName;
      defaultSelect.appendChild(option);
    }

    // Load current default expression
    const character = await invoke('get_character');
    if (character.default_expression) {
      defaultSelect.value = character.default_expression;
    }
  } catch (error) {
    console.error('Failed to load expressions:', error);
  }
}

async function handleUploadExpression() {
  const nameInput = document.getElementById('expression-name-input');
  const expressionName = nameInput.value.trim();

  if (!expressionName) {
    alert('Please enter an expression name first');
    return;
  }

  // Validate expression name (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(expressionName)) {
    alert('Expression name can only contain letters, numbers, hyphens, and underscores');
    return;
  }

  try {
    const characterId = document.getElementById('character-settings-select').value;
    await invoke('select_and_upload_expression', {
      characterId,
      expressionName
    });

    // Clear input and reload gallery
    nameInput.value = '';
    await loadExpressionsGallery(characterId);
  } catch (error) {
    console.error('Failed to upload expression:', error);
    alert(`Failed to upload expression: ${error}`);
  }
}

async function handleDeleteExpression(characterId, expressionName) {
  if (!confirm(`Delete expression "${expressionName}"?`)) {
    return;
  }

  try {
    await invoke('delete_expression', { characterId, expressionName });
    await loadExpressionsGallery(characterId);
  } catch (error) {
    console.error('Failed to delete expression:', error);
    alert(`Failed to delete expression: ${error}`);
  }
}

async function handleDefaultExpressionChange() {
  const select = document.getElementById('default-expression-select');
  const characterId = document.getElementById('character-settings-select').value;
  const expressionName = select.value || null;

  try {
    await invoke('set_default_expression', { characterId, expressionName });
  } catch (error) {
    console.error('Failed to set default expression:', error);
    alert(`Failed to set default expression: ${error}`);
  }
}

// Update expression display panel
async function updateExpressionDisplay(expressionName = null) {
  const panel = document.getElementById('expression-display-panel');
  if (!panel) return;

  try {
    const character = await invoke('get_character');

    // Use provided expression, or fall back to default
    const exprToShow = expressionName || character.default_expression;

    if (!exprToShow || !character.expressions || !character.expressions[exprToShow]) {
      // No expression to show - display placeholder
      panel.innerHTML = '<div class="expression-display-placeholder">No expression available</div>';
      return;
    }

    const filename = character.expressions[exprToShow];
    const fullPath = await invoke('get_expression_full_path', {
      characterId: character.id,
      expressionFilename: filename
    });

    // Create new image element with crossfade
    const newImg = document.createElement('img');
    newImg.src = convertFileSrc(fullPath);
    newImg.alt = exprToShow;
    newImg.style.opacity = '0';
    newImg.style.transition = 'opacity 0.3s ease';

    // Create expression indicator
    const indicator = document.createElement('div');
    indicator.className = 'expression-indicator';
    indicator.textContent = exprToShow;

    // Clear and update panel
    const oldContent = panel.firstChild;
    panel.innerHTML = '';
    panel.appendChild(newImg);
    panel.appendChild(indicator);

    // Trigger crossfade
    setTimeout(() => {
      newImg.style.opacity = '1';
    }, 10);

  } catch (error) {
    console.error('Failed to update expression display:', error);
    panel.innerHTML = '<div class="expression-display-placeholder">Failed to load expression</div>';
  }
}

// Extract expression tags from text
function extractExpressionTags(text) {
  const patterns = [
    /\*([^*]+)\*/g,      // *expression*
    /\(([^)]+)\)/g,      // (expression)
    /\[([^\]]+)\]/g,     // [expression]
    /\{\{([^}]+)\}\}/g   // {{expression}}
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      // Return the first match found
      return matches[0][1].trim().toLowerCase();
    }
  }

  return null;
}

// Detect expression for a message
async function detectMessageExpression(messageText) {
  try {
    const character = await invoke('get_character');

    // First, check for explicit expression tags in the text
    const taggedExpression = extractExpressionTags(messageText);
    if (taggedExpression && character.expressions && character.expressions[taggedExpression]) {
      return taggedExpression;
    }

    // If no tags, use sentiment detection
    if (character.expressions && Object.keys(character.expressions).length > 0) {
      const availableExpressions = Object.keys(character.expressions);
      const detectedExpression = await invoke('detect_expression_from_text', {
        text: messageText,
        availableExpressions
      });

      if (detectedExpression) {
        return detectedExpression;
      }
    }

    // Fall back to default expression
    return character.default_expression || null;
  } catch (error) {
    console.error('Failed to detect expression:', error);
    return null;
  }
}

// ============================================================================
// Group Chat Modal Functions
// ============================================================================

let selectedCharacterIds = [];

async function openGroupChatModal() {
  const modal = document.getElementById('group-chat-modal');
  const nameInput = document.getElementById('group-chat-name');
  const characterList = document.getElementById('group-character-list');

  // Reset state
  selectedCharacterIds = [];
  nameInput.value = '';
  characterList.innerHTML = '';
  updateSelectedCount();
  updateCreateButton();

  // Load characters
  try {
    const characters = await invoke('list_characters');

    if (characters.length < 2) {
      showToast('You need at least 2 characters to create a group chat', 'warning');
      return;
    }

    // Display characters as checkboxes
    characters.forEach(character => {
      const item = document.createElement('div');
      item.className = 'group-character-item';
      item.innerHTML = `
        <input type="checkbox" id="char-${character.id}" value="${character.id}">
        <div class="group-character-avatar">
          ${character.avatar_path ?
            `<img src="asset://localhost/${character.avatar_path}" alt="${character.name}">` :
            `<div class="group-character-avatar-placeholder">${character.name.charAt(0).toUpperCase()}</div>`
          }
        </div>
        <div class="group-character-info">
          <div class="group-character-name">${character.name}</div>
          <div class="group-character-desc">${character.description || character.personality || 'No description'}</div>
        </div>
      `;

      // Make the whole item clickable
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const checkbox = item.querySelector('input[type="checkbox"]');
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });

      // Handle checkbox changes
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedCharacterIds.push(character.id);
        } else {
          selectedCharacterIds = selectedCharacterIds.filter(id => id !== character.id);
        }
        updateSelectedCount();
        updateCreateButton();
      });

      characterList.appendChild(item);
    });

    modal.style.display = 'flex';
    nameInput.focus();
  } catch (error) {
    console.error('Failed to load characters:', error);
    showToast('Failed to load characters', 'error');
  }
}

function closeGroupChatModal() {
  const modal = document.getElementById('group-chat-modal');
  modal.style.display = 'none';
  selectedCharacterIds = [];
}

function updateSelectedCount() {
  const countEl = document.getElementById('selected-count');
  countEl.textContent = `${selectedCharacterIds.length} selected`;
}

function updateCreateButton() {
  const createBtn = document.getElementById('group-chat-create-btn');
  createBtn.disabled = selectedCharacterIds.length < 2;
}

async function createGroupChat() {
  const nameInput = document.getElementById('group-chat-name');
  const name = nameInput.value.trim();

  if (!name) {
    showToast('Please enter a group name', 'warning');
    nameInput.focus();
    return;
  }

  if (selectedCharacterIds.length < 2) {
    showToast('Please select at least 2 characters', 'warning');
    return;
  }

  try {
    const groupChat = await invoke('create_group_chat', {
      characterIds: selectedCharacterIds,
      name
    });

    showToast(`Group chat "${name}" created successfully!`, 'success');
    closeGroupChatModal();

    // Reload characters and group chats to show the new group
    await loadCharacters();

    console.log('Created group chat:', groupChat);
  } catch (error) {
    console.error('Failed to create group chat:', error);
    showToast(`Failed to create group chat: ${error}`, 'error');
  }
}

// Helper function to generate consistent color for a character
function generateCharacterColor(characterId) {
  // Use a simple hash function to convert character ID to a color
  let hash = 0;
  for (let i = 0; i < characterId.length; i++) {
    hash = characterId.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate hue from hash (0-360)
  const hue = Math.abs(hash % 360);

  // Use high saturation and medium-light lightness for vibrant colors
  return `hsl(${hue}, 70%, 55%)`;
}

// ============================================================================
// Group Members Panel Functions
// ============================================================================

let currentGroupChat = null;

async function showGroupMembersPanel(groupChat) {
  currentGroupChat = groupChat;
  const panel = document.getElementById('group-members-panel');
  const membersList = document.getElementById('group-members-list');
  const memberCount = document.getElementById('group-member-count');

  if (!panel || !membersList) return;

  // Show panel
  panel.style.display = 'block';

  // Update count
  memberCount.textContent = `${groupChat.character_ids.length} members`;

  // Clear existing members
  membersList.innerHTML = '';

  // Load group settings to check mute status
  const groupSettings = groupChat.settings || {};
  const talkSettings = groupSettings.character_talk_settings || {};

  try {

    // Populate member list
    for (const charId of groupChat.character_ids) {
      const character = charactersMap[charId];
      if (!character) continue;

      const charSettings = talkSettings[charId] || { muted: false, talkativeness: 50 };

      const memberItem = document.createElement('div');
      memberItem.className = 'group-member-item';
      memberItem.dataset.characterId = charId;

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'group-member-avatar';

      if (character.avatar_path) {
        const url = await getAvatarUrl(character.avatar_path);
        if (url) {
          avatar.style.backgroundImage = `url('${url}')`;
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'group-member-avatar-placeholder';
          placeholder.textContent = character.name.charAt(0).toUpperCase();
          avatar.appendChild(placeholder);
        }
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'group-member-avatar-placeholder';
        placeholder.textContent = character.name.charAt(0).toUpperCase();
        avatar.appendChild(placeholder);
      }

      // Info
      const info = document.createElement('div');
      info.className = 'group-member-info';

      const name = document.createElement('div');
      name.className = 'group-member-name';
      name.textContent = character.name;

      const statusContainer = document.createElement('div');
      statusContainer.className = 'group-member-status-container';

      const statusLabel = document.createElement('div');
      statusLabel.className = `group-member-status${charSettings.muted ? ' muted' : ''}`;
      statusLabel.textContent = charSettings.muted ? 'Muted' : 'Talkativeness';

      info.appendChild(name);
      info.appendChild(statusContainer);
      statusContainer.appendChild(statusLabel);

      // Talkativeness slider (only shown when not muted)
      if (!charSettings.muted) {
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'group-member-slider-container';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = charSettings.talkativeness.toString();
        slider.className = 'group-member-slider';

        const valueLabel = document.createElement('span');
        valueLabel.className = 'group-member-slider-value';
        valueLabel.textContent = `${charSettings.talkativeness}%`;

        slider.addEventListener('input', (e) => {
          valueLabel.textContent = `${e.target.value}%`;
        });

        slider.addEventListener('change', async (e) => {
          await updateMemberTalkativeness(groupChat.id, charId, parseInt(e.target.value));
        });

        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueLabel);
        statusContainer.appendChild(sliderContainer);
      }

      // Actions
      const actions = document.createElement('div');
      actions.className = 'group-member-actions';

      // Mute/Unmute button
      const muteBtn = document.createElement('button');
      muteBtn.className = 'group-member-action-btn';
      muteBtn.title = charSettings.muted ? 'Unmute' : 'Mute';
      muteBtn.innerHTML = charSettings.muted
        ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 5l4-3 4 3v4l-4 3-4-3V5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`
        : `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4v4M10 4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <rect x="3" y="2" width="6" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>`;
      muteBtn.addEventListener('click', () => toggleMemberMute(groupChat.id, charId));
      actions.appendChild(muteBtn);

      // Remove button (only if more than 2 members)
      if (groupChat.character_ids.length > 2) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'group-member-action-btn danger';
        removeBtn.title = 'Remove from group';
        removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
        removeBtn.addEventListener('click', () => removeMemberFromGroup(groupChat.id, charId, character.name));
        actions.appendChild(removeBtn);
      }

      memberItem.appendChild(avatar);
      memberItem.appendChild(info);
      memberItem.appendChild(actions);
      membersList.appendChild(memberItem);
    }
  } catch (error) {
    console.error('Failed to populate group members:', error);
  }
}

function hideGroupMembersPanel() {
  const panel = document.getElementById('group-members-panel');
  if (panel) {
    panel.style.display = 'none';
  }
  currentGroupChat = null;
}

async function toggleMemberMute(groupId, characterId) {
  try {
    const isMuted = await invoke('toggle_character_mute', { groupId, characterId });

    // Refresh the group chat data
    const updatedGroup = await invoke('get_group_chat', { groupId });
    await showGroupMembersPanel(updatedGroup);

    showToast(isMuted ? 'Member muted' : 'Member unmuted', 'success');
  } catch (error) {
    console.error('Failed to toggle mute:', error);
    showToast(`Failed to toggle mute: ${error}`, 'error');
  }
}

async function updateMemberTalkativeness(groupId, characterId, talkativeness) {
  try {
    await invoke('update_character_talk_settings', {
      groupId,
      characterId,
      settings: {
        talkativeness,
        muted: false,
        priority: 0
      }
    });

    // Update current group chat state
    const updatedGroup = await invoke('get_group_chat', { groupId });
    currentGroupChat = updatedGroup;

    showToast(`Talkativeness updated to ${talkativeness}%`, 'success');
  } catch (error) {
    console.error('Failed to update talkativeness:', error);
    showToast(`Failed to update talkativeness: ${error}`, 'error');
  }
}

async function removeMemberFromGroup(groupId, characterId, characterName) {
  // Confirm removal
  const confirmed = confirm(`Remove ${characterName} from the group?`);
  if (!confirmed) return;

  try {
    await invoke('remove_character_from_group', { groupId, characterId });

    // Refresh the group chat data
    const updatedGroup = await invoke('get_group_chat', { groupId });
    await showGroupMembersPanel(updatedGroup);

    showToast(`${characterName} removed from group`, 'success');
  } catch (error) {
    console.error('Failed to remove member:', error);
    showToast(`Failed to remove member: ${error}`, 'error');
  }
}

// ============================================================================
// @Mention Autocomplete Functions
// ============================================================================

let mentionAutocompleteVisible = false;
let mentionSelectedIndex = -1;
let mentionStartPos = -1;
let mentionSearchText = '';

function showMentionAutocomplete(searchText, cursorPos) {
  if (!currentGroupChat) return;

  const autocompleteDiv = document.getElementById('mention-autocomplete');
  mentionSearchText = searchText.toLowerCase();
  mentionStartPos = cursorPos - searchText.length - 1; // -1 for the @ symbol

  // Filter group members based on search text
  const matchingMembers = currentGroupChat.character_ids.filter(charId => {
    const character = charactersMap[charId];
    return character && character.name.toLowerCase().includes(mentionSearchText);
  });

  if (matchingMembers.length === 0) {
    hideMentionAutocomplete();
    return;
  }

  // Populate autocomplete list
  autocompleteDiv.innerHTML = '';
  matchingMembers.forEach((charId, index) => {
    const character = charactersMap[charId];
    if (!character) return;

    const item = document.createElement('div');
    item.className = 'mention-autocomplete-item';
    if (index === 0) {
      item.classList.add('selected');
      mentionSelectedIndex = 0;
    }

    // Avatar
    const avatar = document.createElement('div');
    if (character.avatar_path) {
      avatar.className = 'mention-autocomplete-avatar';
      getAvatarUrl(character.avatar_path).then(url => {
        if (url) {
          avatar.style.backgroundImage = `url('${url}')`;
        }
      });
    } else {
      avatar.className = 'mention-autocomplete-avatar-placeholder';
      avatar.textContent = character.name.charAt(0).toUpperCase();
    }

    // Name
    const name = document.createElement('div');
    name.className = 'mention-autocomplete-name';
    name.textContent = character.name;

    item.appendChild(avatar);
    item.appendChild(name);

    // Click handler
    item.addEventListener('click', () => {
      insertMention(character.name);
    });

    autocompleteDiv.appendChild(item);
  });

  autocompleteDiv.style.display = 'block';
  mentionAutocompleteVisible = true;
}

function hideMentionAutocomplete() {
  const autocompleteDiv = document.getElementById('mention-autocomplete');
  autocompleteDiv.style.display = 'none';
  mentionAutocompleteVisible = false;
  mentionSelectedIndex = -1;
  mentionStartPos = -1;
  mentionSearchText = '';
}

function insertMention(characterName) {
  const input = messageInput;
  const text = input.value;
  const before = text.substring(0, mentionStartPos);
  const after = text.substring(input.selectionStart);

  // Insert mention with @ symbol
  const newText = before + '@' + characterName + ' ' + after;
  input.value = newText;

  // Set cursor position after the mention
  const newCursorPos = (before + '@' + characterName + ' ').length;
  input.setSelectionRange(newCursorPos, newCursorPos);

  hideMentionAutocomplete();
  input.focus();
}

function navigateMentionAutocomplete(direction) {
  const autocompleteDiv = document.getElementById('mention-autocomplete');
  const items = autocompleteDiv.querySelectorAll('.mention-autocomplete-item');

  if (items.length === 0) return;

  // Remove current selection
  if (mentionSelectedIndex >= 0 && mentionSelectedIndex < items.length) {
    items[mentionSelectedIndex].classList.remove('selected');
  }

  // Update index
  if (direction === 'down') {
    mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
  } else {
    mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
  }

  // Add new selection
  items[mentionSelectedIndex].classList.add('selected');

  // Scroll into view
  items[mentionSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentMention() {
  const autocompleteDiv = document.getElementById('mention-autocomplete');
  const items = autocompleteDiv.querySelectorAll('.mention-autocomplete-item');

  if (mentionSelectedIndex >= 0 && mentionSelectedIndex < items.length) {
    const selectedItem = items[mentionSelectedIndex];
    const characterName = selectedItem.querySelector('.mention-autocomplete-name').textContent;
    insertMention(characterName);
  }
}

// Detect @ mentions in message input
function handleMentionInput() {
  if (!currentGroupChat) {
    hideMentionAutocomplete();
    return;
  }

  const input = messageInput;
  const text = input.value;
  const cursorPos = input.selectionStart;

  // Find @ symbol before cursor
  let atPos = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (text[i] === '@') {
      atPos = i;
      break;
    }
    if (text[i] === ' ' || text[i] === '\n') {
      break;
    }
  }

  if (atPos >= 0) {
    // Extract search text after @
    const searchText = text.substring(atPos + 1, cursorPos);

    // Only show autocomplete if @ is at start or preceded by whitespace
    const beforeAt = atPos > 0 ? text[atPos - 1] : ' ';
    if (beforeAt === ' ' || beforeAt === '\n' || atPos === 0) {
      showMentionAutocomplete(searchText, cursorPos);
    } else {
      hideMentionAutocomplete();
    }
  } else {
    hideMentionAutocomplete();
  }
}

// Group Reply Controls Management
function showGroupReplyControls(groupChat) {
  const controls = document.getElementById('group-reply-controls');
  const characterSelect = document.getElementById('group-reply-character');
  const autoToggle = document.getElementById('group-auto-mode-toggle');

  controls.style.display = 'flex';

  // Populate character dropdown with group members
  characterSelect.innerHTML = '<option value="">Select character...</option>';

  for (const charId of groupChat.character_ids) {
    const character = charactersMap[charId];
    if (character) {
      const option = document.createElement('option');
      option.value = charId;
      option.textContent = character.name;
      characterSelect.appendChild(option);
    }
  }

  // Set auto-mode toggle state
  autoToggle.checked = groupChat.settings?.auto_mode || false;

  // Disable character select if auto-mode is on
  characterSelect.disabled = autoToggle.checked;
}

function hideGroupReplyControls() {
  const controls = document.getElementById('group-reply-controls');
  controls.style.display = 'none';
}

async function handleGroupAutoModeToggle() {
  if (!currentGroupChat) return;

  try {
    const isAutoMode = await invoke('toggle_auto_mode', { groupId: currentGroupChat.id });
    const characterSelect = document.getElementById('group-reply-character');
    characterSelect.disabled = isAutoMode;

    // Update current group chat state
    const updatedGroup = await invoke('get_group_chat', { groupId: currentGroupChat.id });
    currentGroupChat = updatedGroup;

    showToast(isAutoMode ? 'Auto-mode enabled' : 'Auto-mode disabled', 'success');
  } catch (error) {
    console.error('Failed to toggle auto-mode:', error);
    showToast(`Failed to toggle auto-mode: ${error}`, 'error');
  }
}

async function sendGroupMessage(message, isRegenerate = false) {
  const autoToggle = document.getElementById('group-auto-mode-toggle');
  const characterSelect = document.getElementById('group-reply-character');
  const isAutoMode = autoToggle.checked;

  if (!isRegenerate) {
    await addMessage(message, true, false, Date.now());
  }

  sendBtn.disabled = true;
  messageInput.disabled = true;
  setStatus('Generating group response...', 'default');

  try {
    let response;
    let respondingCharacterId;

    if (isAutoMode) {
      // Auto-mode: backend selects the character
      const result = await invoke('generate_group_response_auto', {
        groupId: currentGroupChat.id,
        userMessage: message
      });
      response = result.response;
      respondingCharacterId = result.character_id;
    } else {
      // Manual mode: user selects the character
      respondingCharacterId = characterSelect.value;

      if (!respondingCharacterId) {
        throw new Error('Please select a character to respond');
      }

      response = await invoke('generate_group_response', {
        groupId: currentGroupChat.id,
        characterId: respondingCharacterId,
        userMessage: message
      });
    }

    // Get character info for the responding character
    const respondingCharacter = charactersMap[respondingCharacterId];

    // Add the response with character info
    await addMessage(response, false, false, Date.now(), {
      id: respondingCharacterId,
      name: respondingCharacter?.name || 'Unknown',
      avatar_path: respondingCharacter?.avatar_path
    });

    setStatus('Response complete', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to generate group response:', error);
    addMessage(`Error: ${error}`, false);
    setStatus(`Error: ${error.toString().substring(0, 50)}...`, 'error');
  } finally {
    sendBtn.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

// Event listeners for group chat modal
document.addEventListener('DOMContentLoaded', () => {
  const newGroupChatBtn = document.getElementById('new-group-chat-btn');
  const groupChatModal = document.getElementById('group-chat-modal');
  const groupChatOverlay = groupChatModal.querySelector('.group-chat-overlay');
  const closeBtn = document.getElementById('group-chat-close-btn');
  const cancelBtn = document.getElementById('group-chat-cancel-btn');
  const createBtn = document.getElementById('group-chat-create-btn');

  newGroupChatBtn.addEventListener('click', openGroupChatModal);
  groupChatOverlay.addEventListener('click', closeGroupChatModal);
  closeBtn.addEventListener('click', closeGroupChatModal);
  cancelBtn.addEventListener('click', closeGroupChatModal);
  createBtn.addEventListener('click', createGroupChat);

  // Handle Enter key in group name input
  document.getElementById('group-chat-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && selectedCharacterIds.length >= 2) {
      createGroupChat();
    }
  });

  // Group reply controls event listeners
  const autoModeToggle = document.getElementById('group-auto-mode-toggle');
  if (autoModeToggle) {
    autoModeToggle.addEventListener('change', handleGroupAutoModeToggle);
  }
});
