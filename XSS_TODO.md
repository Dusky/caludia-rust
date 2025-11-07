# innerHTML XSS Remediation TODO

## Status: 3/127 Fixed (Critical message rendering secured)

## ✅ Fixed (High Priority)
- [x] Line 2405: Main message rendering (marked.parse output)
- [x] Line 2470: User message with images (marked.parse output)
- [x] Line 2546: Assistant message rendering (marked.parse output)

## 🔴 High Risk - Needs Immediate Fix
These involve user-generated content or search terms:

- [ ] Line 1322: Search highlighting (user search terms) - SANITIZE
- [ ] Character card imports (user-uploaded data)
- [ ] World info entry content (user descriptions)
- [ ] Plugin UI rendering (plugin-generated content)
- [ ] Character descriptions in UI

## 🟡 Medium Risk - Review Required
Template literals with data that might come from user:

- [ ] Line 510: Toast messages (check if user content goes here)
- [ ] Line 838-885: Command palette (likely safe - internal commands)
- [ ] Settings UI rendering

## 🟢 Low Risk - Likely Safe
Static strings or empty assignments:

- [ ] `messagesContainer.innerHTML = ''` (clearing, safe)
- [ ] `innerHTML = '<option>...'` (static HTML, safe)
- [ ] Template literals with only internal app state

## Strategy

### Phase 1 (NOW): Secure Critical Paths
- ✅ Message rendering (DONE)
- 🔄 Search highlighting
- 🔄 Character data display
- 🔄 World info rendering

### Phase 2 (Later): Comprehensive Audit
- Systematically review all 127 cases
- Add inline comments marking reviewed ones
- Create wrapper functions for common patterns

### Phase 3 (Final): Refactoring
- Move to .textContent where HTML not needed
- Use DocumentFragment for dynamic content
- Consider moving to a framework (React/Vue) for automatic escaping

## Notes
- Many assignments to `''` or static strings are safe
- Focus on anything involving:
  - User input
  - Character data
  - File imports
  - Search/filter results
  - Plugin content
