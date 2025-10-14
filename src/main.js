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
function addMessage(content, isUser = false, skipActions = false, timestamp = null) {
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

    // Add timestamp if provided
    if (timestamp) {
      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'message-timestamp';
      timestampDiv.textContent = formatTimestamp(timestamp);
      contentDiv.appendChild(timestampDiv);
    }
  } else {
    // Assistant messages: render as markdown
    // Add character name indicator if character exists
    if (currentCharacter && currentCharacter.name) {
      const nameIndicator = document.createElement('div');
      nameIndicator.className = 'character-name-indicator';
      nameIndicator.textContent = currentCharacter.name;
      contentDiv.appendChild(nameIndicator);
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

  // Handle cancel
  cancelBtn.addEventListener('click', () => {
    contentDiv.innerHTML = originalHTML;
    actionsDiv.style.display = 'flex';
  });

  // Handle save
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newContent = textarea.value.trim();

    if (!newContent || newContent === originalContent) {
      contentDiv.innerHTML = originalHTML;
      actionsDiv.style.display = 'flex';
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
      // Truncate history from this point
      await invoke('truncate_history_from', { index: messageIndex });

      // Remove all messages from this point forward in UI
      while (messagesContainer.children[messageIndex]) {
        messagesContainer.children[messageIndex].remove();
      }

      // Send the edited message
      await sendMessage(newContent);
    } catch (error) {
      console.error('Failed to edit message:', error);
      contentDiv.innerHTML = originalHTML;
      actionsDiv.style.display = 'flex';
      addMessage(`Error editing message: ${error}`, false);
    }
  });
}

// Handle regenerating an assistant message
async function handleRegenerateMessage(messageDiv) {
  const regenerateBtn = messageDiv.querySelector('.message-action-btn');
  regenerateBtn.disabled = true;

  try {
    // Get the last user message
    const lastUserMessage = await invoke('get_last_user_message');

    // Generate new response
    await generateSwipe(messageDiv, lastUserMessage);
  } catch (error) {
    console.error('Failed to regenerate message:', error);
    regenerateBtn.disabled = false;
    addMessage(`Error regenerating message: ${error}`, false);
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
    if (regenerateBtn) regenerateBtn.disabled = false;
  } catch (error) {
    setStatus(`Regeneration failed: ${error.substring(0, 40)}...`, 'error');
    const regenerateBtn = messageDiv.querySelector('.message-action-btn');
    if (regenerateBtn) regenerateBtn.disabled = false;
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
    if (regenerateBtn) regenerateBtn.disabled = false;
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
    if (regenerateBtn) regenerateBtn.disabled = false;
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

// Extract message sending logic into separate function
async function sendMessage(message, isRegenerate = false) {
  if (!isRegenerate) {
    addMessage(message, true, false, Date.now());
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
      const response = await invoke('chat', { message });
      removeTypingIndicator();
      addMessage(response, false);
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

  messageInput.value = '';
  autoResize(messageInput);

  await sendMessage(message);
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
  setStatus('Saving configuration...', 'default');

  try {
    await invoke('save_api_config', { baseUrl, apiKey, model, stream });
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
  document.getElementById('import-character-btn').addEventListener('click', handleImportCharacter);
  document.getElementById('export-character-btn').addEventListener('click', handleExportCharacter);
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
  setStatus('Switching character...', 'default');
  try {
    await invoke('set_active_character', { characterId });
    messagesContainer.innerHTML = '';
    await loadCharacters();
    setStatus('Character switched', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    console.error('Failed to switch character:', error);
    setStatus('Failed to switch character', 'error');
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

// Handle character card import
async function handleImportCharacter() {
  const characterMsg = document.getElementById('character-message');
  try {
    const importedCharacter = await invoke('import_character_card');
    characterMsg.textContent = `Successfully imported ${importedCharacter.name}!`;
    characterMsg.className = 'validation-message success';

    // Reload characters and switch to the imported one
    await loadCharacters();
    await loadCharacterSettings();

    setTimeout(() => {
      characterMsg.style.display = 'none';
    }, 3000);
  } catch (error) {
    console.error('Failed to import character:', error);
    if (error && !error.toString().includes('No file selected') && !error.toString().includes('cancelled')) {
      characterMsg.textContent = `Failed to import: ${error}`;
      characterMsg.className = 'validation-message error';
    }
  }
}

// Handle character card export
async function handleExportCharacter() {
  const characterMsg = document.getElementById('character-message');
  try {
    const characterId = document.getElementById('character-settings-select').value;
    const outputPath = await invoke('export_character_card', { characterId });
    characterMsg.textContent = `Successfully exported to ${outputPath}`;
    characterMsg.className = 'validation-message success';

    setTimeout(() => {
      characterMsg.style.display = 'none';
    }, 3000);
  } catch (error) {
    console.error('Failed to export character:', error);
    if (error && !error.toString().includes('cancelled')) {
      characterMsg.textContent = `Failed to export: ${error}`;
      characterMsg.className = 'validation-message error';
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
        addMessage(currentCharacter.greeting, false, true);
      } else {
        addMessage('API configured. Ready to chat.', false, true);
      }
    } else {
      history.forEach((msg, index) => {
        const messageDiv = addMessage(msg.content, msg.role === 'user', false, msg.timestamp);

        // Update swipe controls for assistant messages with swipe info
        if (msg.role === 'assistant' && messageDiv && msg.swipes && msg.swipes.length > 0) {
          updateSwipeControls(messageDiv, msg.current_swipe || 0, msg.swipes.length);
        }
      });
    }
  } catch (error) {
    console.error('Failed to load chat history:', error);
    messagesContainer.innerHTML = '';
    addMessage('API configured. Ready to chat.', false, true);
  }
}

// Clear chat history
async function clearHistory() {
  if (!confirm('Clear conversation history? This cannot be undone.')) {
    return;
  }

  setStatus('Clearing history...', 'default');
  try {
    await invoke('clear_chat_history');
    messagesContainer.innerHTML = '';
    if (currentCharacter && currentCharacter.greeting) {
      addMessage(currentCharacter.greeting, false, true);
    } else {
      addMessage('Conversation cleared. Ready to chat.', false, true);
    }
    setStatus('History cleared', 'success');
    setTimeout(() => setStatus('Ready'), 2000);
  } catch (error) {
    setStatus('Failed to clear history', 'error');
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
