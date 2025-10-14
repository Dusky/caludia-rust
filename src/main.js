const { invoke } = window.__TAURI__.core;

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

// Auto-resize textarea
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Add message to chat
function addMessage(content, isUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar-circle';

  // Set avatar image for assistant messages
  if (!isUser && currentCharacter && currentCharacter.avatar_path) {
    getAvatarUrl(currentCharacter.avatar_path).then(url => {
      if (url) {
        avatar.style.backgroundImage = `url('${url}')`;
        makeAvatarClickable(avatar, url);
      }
    });
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (isUser) {
    // User messages: plain text
    const p = document.createElement('p');
    p.textContent = content;
    contentDiv.appendChild(p);
  } else {
    // Assistant messages: render as markdown
    contentDiv.innerHTML = marked.parse(content);

    // Apply syntax highlighting to code blocks
    contentDiv.querySelectorAll('pre code').forEach((block) => {
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
  }

  if (!isUser) {
    messageDiv.appendChild(avatar);
  }
  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

// Update status
function setStatus(text) {
  statusText.textContent = text;
}

// Show/hide settings
async function showSettings() {
  settingsPanel.style.display = 'block';
  chatView.style.display = 'none';
  await loadCharacterSettings();
}

function hideSettings() {
  settingsPanel.style.display = 'none';
  chatView.style.display = 'flex';
}

// Tab switching
function setupTabs() {
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
    });
  });
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  addMessage(message, true);
  messageInput.value = '';
  autoResize(messageInput);

  sendBtn.disabled = true;
  messageInput.disabled = true;
  setStatus('Thinking...');

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
    setStatus('Streaming...');
    statusText.classList.add('streaming');

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

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    streamingMessageDiv = messageDiv;
    streamingContentDiv = contentDiv;

    // Set up event listeners for streaming
    const { listen } = window.__TAURI__.event;

    const tokenUnlisten = await listen('chat-token', (event) => {
      const token = event.payload;
      fullContent += token;

      // Update content with markdown rendering
      streamingContentDiv.innerHTML = marked.parse(fullContent);

      // Apply syntax highlighting
      streamingContentDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);

        // Add copy button
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

      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    const completeUnlisten = await listen('chat-complete', () => {
      setStatus('Ready');
      statusText.classList.remove('streaming');
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
      statusText.classList.remove('streaming');
      if (streamingMessageDiv) {
        streamingMessageDiv.remove();
      }
      if (error.includes('not configured')) {
        addMessage('API not configured. Please configure your API settings.', false);
        setTimeout(showSettings, 1000);
      } else {
        addMessage(`Error: ${error}`, false);
      }
      setStatus('Error');
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }
  } else {
    // Use non-streaming
    showTypingIndicator();

    try {
      const response = await invoke('chat', { message });
      removeTypingIndicator();
      addMessage(response, false);
      setStatus('Ready');
    } catch (error) {
      removeTypingIndicator();
      if (error.includes('not configured')) {
        addMessage('API not configured. Please configure your API settings.', false);
        setTimeout(showSettings, 1000);
      } else {
        addMessage(`Error: ${error}`, false);
      }
      setStatus('Error');
    } finally {
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }
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
  validateBtn.textContent = 'Validating...';
  validationMsg.style.display = 'none';

  try {
    const models = await invoke('validate_api', { baseUrl, apiKey });

    validationMsg.textContent = `Found ${models.length} models`;
    validationMsg.className = 'validation-message success';

    modelSelect.innerHTML = '<option value="">Select a model</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });

    modelsGroup.style.display = 'flex';
    saveBtn.disabled = false;
  } catch (error) {
    validationMsg.textContent = `Validation failed: ${error}`;
    validationMsg.className = 'validation-message error';
    modelsGroup.style.display = 'none';
    saveBtn.disabled = true;
  } finally {
    validateBtn.disabled = false;
    validateBtn.textContent = 'Validate';
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();

  const baseUrl = document.getElementById('api-base-url').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model-select').value;
  const stream = document.getElementById('stream-toggle').checked;
  const saveBtn = document.getElementById('save-settings-btn');
  const validationMsg = document.getElementById('validation-message');

  if (!model) {
    validationMsg.textContent = 'Please select a model';
    validationMsg.className = 'validation-message error';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await invoke('save_api_config', { baseUrl, apiKey, model, stream });
    validationMsg.textContent = 'Configuration saved successfully';
    validationMsg.className = 'validation-message success';

    setTimeout(() => {
      hideSettings();
      messagesContainer.innerHTML = '';
      addMessage('API configured. Ready to chat.', false);
    }, 1000);
  } catch (error) {
    validationMsg.textContent = `Failed to save: ${error}`;
    validationMsg.className = 'validation-message error';
  } finally {
    saveBtn.disabled = false;
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
  document.getElementById('clear-btn').addEventListener('click', clearHistory);
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
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  });

  messageInput.addEventListener('input', () => {
    autoResize(messageInput);
  });
}

// Load characters and populate dropdown
async function loadCharacters() {
  console.log('Loading characters...');
  try {
    const characters = await invoke('list_characters');
    console.log('Loaded characters:', characters);
    characterSelect.innerHTML = '';
    characters.forEach(char => {
      const option = document.createElement('option');
      option.value = char.id;
      option.textContent = char.name;
      characterSelect.appendChild(option);
    });

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
  } catch (error) {
    console.error('Failed to load characters:', error);
    addMessage(`Failed to load characters: ${error}`, false);
  }
}

// Handle character switching
async function handleCharacterSwitch() {
  const characterId = characterSelect.value;
  try {
    await invoke('set_active_character', { characterId });
    messagesContainer.innerHTML = '';
    await loadCharacters();
  } catch (error) {
    console.error('Failed to switch character:', error);
    addMessage(`Failed to switch character: ${error}`, false);
  }
}

// Handle new character creation
async function handleNewCharacter() {
  const name = prompt('Enter a name for the new character:');
  if (!name) return;

  const systemPrompt = prompt('Enter the system prompt for the new character:', 'You are a helpful AI assistant.');
  if (!systemPrompt) return;

  try {
    const newCharacter = await invoke('create_character', { name, systemPrompt });
    await loadCharacters();
    characterSelect.value = newCharacter.id;
  } catch (error) {
    console.error('Failed to create character:', error);
    addMessage(`Failed to create character: ${error}`, false);
  }
}

// Handle character deletion
async function handleDeleteCharacter() {
  if (!currentCharacter || currentCharacter.id === 'default') {
    addMessage('Cannot delete the default character.', false);
    return;
  }

  if (confirm(`Are you sure you want to delete ${currentCharacter.name}? This cannot be undone.`)) {
    try {
      await invoke('delete_character', { characterId: currentCharacter.id });
      await loadCharacters();
      hideSettings();
    } catch (error) {
      console.error('Failed to delete character:', error);
      addMessage(`Failed to delete character: ${error}`, false);
    }
  }
}

// Load chat history
async function loadChatHistory() {
  try {
    const history = await invoke('get_chat_history');
    messagesContainer.innerHTML = '';

    if (history.length === 0) {
      if (currentCharacter && currentCharacter.greeting) {
        addMessage(currentCharacter.greeting, false);
      } else {
        addMessage('API configured. Ready to chat.', false);
      }
    } else {
      history.forEach(msg => {
        addMessage(msg.content, msg.role === 'user');
      });
    }
  } catch (error) {
    console.error('Failed to load chat history:', error);
    messagesContainer.innerHTML = '';
    addMessage('API configured. Ready to chat.', false);
  }
}

// Clear chat history
async function clearHistory() {
  if (!confirm('Clear conversation history? This cannot be undone.')) {
    return;
  }

  try {
    await invoke('clear_chat_history');
    messagesContainer.innerHTML = '';
    if (currentCharacter && currentCharacter.greeting) {
      addMessage(currentCharacter.greeting, false);
    } else {
      addMessage('Conversation cleared. Ready to chat.', false);
    }
  } catch (error) {
    addMessage(`Failed to clear history: ${error}`, false);
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

    // Load avatar preview
    const avatarPreview = document.querySelector('.avatar-circle-large');
    const removeAvatarBtn = document.getElementById('remove-avatar-btn');
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
  const saveBtn = document.getElementById('save-character-btn');
  const characterMsg = document.getElementById('character-message');

  if (!name || !systemPrompt) {
    characterMsg.textContent = 'Name and System Prompt are required';
    characterMsg.className = 'validation-message error';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await invoke('update_character', {
      name,
      systemPrompt,
      greeting,
      personality,
      avatarPath: pendingAvatarPath
    });
    characterMsg.textContent = 'Character saved successfully';
    characterMsg.className = 'validation-message success';

    await loadCharacters();

    setTimeout(() => {
      characterMsg.style.display = 'none';
    }, 3000);
  } catch (error) {
    characterMsg.textContent = `Failed to save: ${error}`;
    characterMsg.className = 'validation-message error';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Character';
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

  chatForm.addEventListener('submit', handleSubmit);
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);
  document.getElementById('character-form').addEventListener('submit', handleSaveCharacter);
  document.getElementById('validate-btn').addEventListener('click', handleValidate);

  setupAppControls();
  setupKeyboardShortcuts();
  setupTabs();

  // Avatar modal close handlers
  const avatarModal = document.getElementById('avatar-modal');
  const avatarModalOverlay = document.querySelector('.avatar-modal-overlay');

  avatarModalOverlay.addEventListener('click', hideAvatarModal);

  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && avatarModal.style.display !== 'none') {
      hideAvatarModal();
    }
  });

  messageInput.focus();
  setStatus('Ready');

  loadExistingConfig();
});
