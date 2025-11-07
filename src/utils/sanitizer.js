// ============================================================================
// HTML SANITIZER
// ============================================================================
// Safe HTML sanitization to prevent XSS attacks
// Uses DOMPurify to clean user-generated content

import DOMPurify from 'dompurify';

/**
 * Default configuration for message content
 * Allows common formatting but blocks dangerous elements
 */
const MESSAGE_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'em', 'strong', 'u', 's', 'strike',
    'p', 'br', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',
    'src', 'alt', 'title',
    'class', 'id',
    'width', 'height',
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

/**
 * Strict configuration for user input (character names, descriptions)
 * Very limited HTML, mostly plain text
 */
const STRICT_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
};

/**
 * Configuration for rich content (character cards with markdown)
 */
const RICH_CONFIG = {
  ...MESSAGE_CONFIG,
  ALLOWED_TAGS: [
    ...MESSAGE_CONFIG.ALLOWED_TAGS,
    'hr', 'sup', 'sub', 'mark', 'del', 'ins',
  ],
};

/**
 * Sanitize HTML content to prevent XSS attacks
 *
 * @param {string} html - HTML content to sanitize
 * @param {Object} options - DOMPurify configuration options
 * @returns {string} - Sanitized HTML safe for innerHTML
 *
 * @example
 * // Sanitize message content
 * messageDiv.innerHTML = sanitizeHTML(userContent);
 *
 * // Sanitize with custom config
 * const safe = sanitizeHTML(html, { ALLOWED_TAGS: ['p', 'br'] });
 */
export function sanitizeHTML(html, options = MESSAGE_CONFIG) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  try {
    return DOMPurify.sanitize(html, options);
  } catch (error) {
    console.error('Sanitization failed:', error);
    return ''; // Return empty string on error (fail safe)
  }
}

/**
 * Sanitize and convert plain text to HTML-safe text
 * Escapes all HTML entities - use for display of untrusted text
 *
 * @param {string} text - Plain text to escape
 * @returns {string} - HTML-escaped text
 *
 * @example
 * // Safe text display (no HTML at all)
 * nameDiv.innerHTML = sanitizeText(userName);
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sanitize message content (allows formatting)
 *
 * @param {string} html - Message HTML
 * @returns {string} - Sanitized message HTML
 */
export function sanitizeMessage(html) {
  return sanitizeHTML(html, MESSAGE_CONFIG);
}

/**
 * Sanitize user input strictly (minimal HTML)
 * Use for: character names, usernames, titles
 *
 * @param {string} html - User input
 * @returns {string} - Strictly sanitized HTML
 */
export function sanitizeUserInput(html) {
  return sanitizeHTML(html, STRICT_CONFIG);
}

/**
 * Sanitize rich content (character descriptions, world info)
 *
 * @param {string} html - Rich content HTML
 * @returns {string} - Sanitized rich HTML
 */
export function sanitizeRichContent(html) {
  return sanitizeHTML(html, RICH_CONFIG);
}

/**
 * Sanitize URL to prevent javascript: and data: URLs
 *
 * @param {string} url - URL to sanitize
 * @returns {string} - Safe URL or empty string
 */
export function sanitizeURL(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim().toLowerCase();

  // Block dangerous protocols
  if (trimmed.startsWith('javascript:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('vbscript:') ||
      trimmed.startsWith('file:')) {
    console.warn('Blocked dangerous URL protocol:', url);
    return '';
  }

  // Only allow http(s) and relative URLs
  if (trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../')) {
    return url;
  }

  // Default to https for domains
  if (!trimmed.includes(':')) {
    return 'https://' + url;
  }

  console.warn('Blocked unrecognized URL format:', url);
  return '';
}

/**
 * Safely set element content
 * Automatically chooses between textContent and sanitized innerHTML
 *
 * @param {HTMLElement} element - Target element
 * @param {string} content - Content to set
 * @param {boolean} allowHTML - Whether to allow HTML (default: false)
 * @param {Object} options - Sanitization options
 *
 * @example
 * // Plain text (safe)
 * setElementContent(nameEl, userName);
 *
 * // HTML with sanitization
 * setElementContent(messageEl, messageHTML, true);
 */
export function setElementContent(element, content, allowHTML = false, options = MESSAGE_CONFIG) {
  if (!element) {
    console.error('setElementContent: element is null');
    return;
  }

  if (!content) {
    element.textContent = '';
    return;
  }

  if (allowHTML) {
    element.innerHTML = sanitizeHTML(content, options);
  } else {
    element.textContent = content;
  }
}

/**
 * Create a safe HTML element from HTML string
 * Returns a DocumentFragment with sanitized content
 *
 * @param {string} html - HTML string
 * @param {Object} options - Sanitization options
 * @returns {DocumentFragment} - Safe DOM fragment
 *
 * @example
 * const fragment = createSafeElement('<p>Hello <b>World</b></p>');
 * container.appendChild(fragment);
 */
export function createSafeElement(html, options = MESSAGE_CONFIG) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeHTML(html, options);
  return template.content;
}

/**
 * Validate if content contains potentially dangerous patterns
 * Use this BEFORE sanitization for logging/warnings
 *
 * @param {string} content - Content to validate
 * @returns {Object} - { safe: boolean, threats: string[] }
 */
export function detectThreats(content) {
  const threats = [];

  if (/<script/i.test(content)) threats.push('script tags');
  if (/on\w+\s*=/i.test(content)) threats.push('event handlers');
  if (/javascript:/i.test(content)) threats.push('javascript: protocol');
  if (/data:text\/html/i.test(content)) threats.push('data: URL');
  if (/<iframe/i.test(content)) threats.push('iframe');
  if (/<object/i.test(content)) threats.push('object tag');
  if (/<embed/i.test(content)) threats.push('embed tag');
  if (/<form/i.test(content)) threats.push('form tag');

  return {
    safe: threats.length === 0,
    threats,
  };
}

/**
 * Configure DOMPurify hooks for enhanced security
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Ensure external links open in new tab with security attributes
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    const href = node.getAttribute('href');
    if (href.startsWith('http://') || href.startsWith('https://')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }

  // Add loading="lazy" to images for performance
  if (node.tagName === 'IMG' && !node.hasAttribute('loading')) {
    node.setAttribute('loading', 'lazy');
  }
});

// Log when sanitization removes content (for debugging)
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.allowedTags && !data.allowedTags[data.tagName]) {
    console.warn(`Sanitizer removed dangerous tag: <${data.tagName}>`);
  }
});

export default {
  sanitizeHTML,
  sanitizeText,
  sanitizeMessage,
  sanitizeUserInput,
  sanitizeRichContent,
  sanitizeURL,
  setElementContent,
  createSafeElement,
  detectThreats,
};
