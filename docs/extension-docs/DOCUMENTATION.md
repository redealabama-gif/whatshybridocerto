# WhatsHybrid Lite - Technical Documentation

## Overview

WhatsHybrid Lite is a Chrome extension that automates message sending on WhatsApp Web. This documentation provides technical details for developers working on the project.

## Architecture

### Core Components

1. **Background Service Worker** (`background.js`)
   - Manages campaign state and queue
   - Handles network sniffing for phone number extraction
   - Provides message routing between popup and content scripts
   - Implements single consolidated message listener pattern

2. **Content Scripts** (`content/`)
   - `content.js` - Main content script (DOM manipulation, campaign execution)
   - `utils/constants.js` - Global configuration and constants
   - `utils/logger.js` - Centralized logging framework
   - `utils/phone-validator.js` - Phone number validation and normalization
   - `utils/selectors.js` - DOM selector definitions
   - `worker-content.js` - Group contact extraction with caching
   - `wpp-hooks.js` - WhatsApp API hooks and integration
   - `extractor.contacts.js` - Contact extraction from WhatsApp DOM

3. **Popup Interface** (`popup/`)
   - `popup.html` - Extension popup UI
   - `popup.js` - Popup logic and campaign management

### Data Flow

```
User Action (Popup) 
  → Background Script (Campaign Management)
    → Content Script (WhatsApp DOM Manipulation)
      → WhatsApp Web API
        → Message Sent
          → Status Update → Popup
```

## Configuration

### Feature Flags (`content/utils/constants.js`)

```javascript
WHL_CONFIG = {
  USE_DIRECT_API: true,              // Use direct API methods (recommended)
  API_RETRY_ON_FAIL: true,           // Retry with URL mode if API fails
  USE_WORKER_FOR_SENDING: false,     // Worker tab (disabled - unreliable)
  USE_INPUT_ENTER_METHOD: false,     // Input+Enter method (disabled - causes reloads)
  DEBUG: false                        // Debug mode
}
```

### Timeouts

- `SEND_MESSAGE`: 45 seconds
- `WAIT_FOR_ELEMENT`: 10 seconds
- `CHAT_OPEN`: 30 seconds
- `MESSAGE_TYPE_DELAY`: 300ms
- `AFTER_SEND_DELAY`: 1 second

### Performance Limits

- `MAX_RESPONSE_SIZE`: 100KB - Skip network extraction for large responses
- `MAX_WEBSOCKET_SIZE`: 50KB - Skip WebSocket extraction for large messages
- `NETWORK_EXTRACT_THROTTLE`: 1 second - Throttle network extraction interval
- `NETSNIFFER_MAX_PHONES`: 5000 - Maximum phones in memory (reduced from 10000)

## Phone Number Handling

### Sanitization

All phone numbers are sanitized using the centralized `WHL_PhoneValidator.sanitizePhone()` function:
- Removes non-numeric characters (spaces, hyphens, parentheses)
- Preserves all digits
- Never generates random numbers

### Normalization

Brazilian phone numbers are normalized with country code:
- 11 digits with 9 as 3rd digit (mobile): `11987654321` → `5511987654321`
- 10 digits (landline): `1133334444` → `551133334444`
- 11 digits without 9 as 3rd digit (old mobile): adds `55` prefix
- 8-9 digits (local without area code): returns null (cannot normalize)

### Validation

- Minimum: 8 digits (local number)
- Maximum: 15 digits (international format)
- Brazilian numbers should have at least 10 digits (DDD + number)

## Message Sending Methods

### 1. Direct API (Active)

Uses validated WhatsApp API methods:
- `enviarMensagemAPI` - Send text messages
- `enviarImagemDOM` - Send images with captions

**Advantages:**
- No page reload
- Reliable delivery confirmation
- Faster execution

### 2. URL Mode (Fallback)

Navigates to `https://web.whatsapp.com/send?phone=X&text=Y`

**Disadvantages:**
- Causes page reload
- Slower execution
- Less reliable

### 3. Input + Enter (Disabled)

Types in input field and simulates Enter key

**Why Disabled:**
- Causes unexpected page reloads
- Less reliable than Direct API

## Security

### postMessage Security

All `window.postMessage` calls use `window.location.origin` instead of `'*'`:

```javascript
// ✅ Secure
window.postMessage({ type: 'ACTION' }, window.location.origin);

// ❌ Insecure (removed)
window.postMessage({ type: 'ACTION' }, '*');
```

All message listeners validate origin:

```javascript
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin) return;
  // ... handle message
});
```

### Network Sniffing

NetSniffer extracts phone numbers from WhatsApp Web network traffic:
- Uses only WhatsApp-specific pattern: `/(\d{10,15})@c\.us/g`
- Generic numeric pattern removed (security fix)
- Limited to 5000 phones in memory
- Periodic cleanup every 5 minutes

## Logging

### Centralized Logger (`content/utils/logger.js`)

All logging uses `window.whlLog`:

```javascript
whlLog.debug('Debug message');    // Only in debug mode
whlLog.info('Info message');      // Always shown
whlLog.warn('Warning message');   // Warnings
whlLog.error('Error message');    // Errors
whlLog.caught('operation', err);  // Caught exceptions
```

Enable debug mode: `localStorage.setItem('whl_debug', 'true')`

## Campaign State Management

### Background Script

Manages:
- Campaign queue (`campaignQueue`)
- Campaign state (`campaignState`)
- Worker tab ID (if used)
- Message routing

### Content Script

Manages:
- DOM manipulation
- Message sending execution
- UI updates
- Progress tracking

### Storage

Uses `chrome.storage.local`:
- `whl_state` - Campaign state
- `whl_stats` - Statistics
- `campaignQueue` - Message queue
- `campaignState` - Campaign status

## DOM Selectors

Selectors are defined in `content/utils/selectors.js` with fallback options:

```javascript
MESSAGE_INPUT: [
  '[data-testid="conversation-compose-box-input"]',
  'footer div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"][role="textbox"]'
]
```

## Contact Extraction

### Sources

1. **DOM Elements**: `#pane-side`, chat cells, contact titles
2. **WhatsApp Store**: Direct access to WhatsApp's internal store
3. **Network Traffic**: Phone numbers from WebSocket and HTTP requests
4. **Groups**: Group member extraction

### Process

1. Scroll through contact list
2. Extract from multiple sources
3. Validate format (8-15 digits)
4. Remove duplicates
5. Store with confidence scores

### Confidence Scoring

Each phone gets a confidence score based on:
- Base score: 10 points
- Multiple origins: +30 points
- From WhatsApp Store: +30 points
- From group: +10 points
- Has name: +15 points
- Is active chat: +10 points

Threshold: 60 points for valid extraction

## Testing

### Manual Testing Checklist

1. **Message Sending**
   - [ ] Text message to single contact
   - [ ] Image with caption
   - [ ] Campaign with multiple contacts
   - [ ] Pause/resume campaign
   - [ ] Stop campaign

2. **Contact Extraction**
   - [ ] Extract from chat list
   - [ ] Extract from groups
   - [ ] Verify no random numbers generated

3. **Error Handling**
   - [ ] Invalid phone number handling
   - [ ] Network timeout handling
   - [ ] WhatsApp Web not loaded

4. **UI**
   - [ ] Progress bar updates in real-time
   - [ ] Statistics update correctly
   - [ ] Status icons match actual status

## Common Issues

### Issue: Progress bar doesn't update
**Solution**: Fixed in latest version - progress bar updates in real-time after each operation.

### Issue: Numbers don't match contacts
**Solution**: Numbers are sanitized (formatting removed) but never modified. Check input format.

### Issue: Campaign stops unexpectedly
**Solution**: Enable "Continue on errors" option. Check console for error messages.

## Development

### Build Requirements

- Chrome/Edge browser with extension development mode enabled
- No build step required - load unpacked extension directly

### File Structure

```
ultimo/
├── background.js              # Background service worker
├── manifest.json              # Extension configuration
├── content/
│   ├── content.js            # Main content script
│   ├── utils/                # Utility modules
│   ├── worker-content.js     # Group extraction
│   ├── wpp-hooks.js          # WhatsApp API hooks
│   └── extractor.contacts.js # Contact extraction
├── popup/
│   ├── popup.html            # Popup UI
│   └── popup.js              # Popup logic
├── icons/                    # Extension icons
└── docs/                     # Documentation
```

### Code Style

- Use strict mode
- Prefer const over let
- Use arrow functions for callbacks
- Add JSDoc comments for public functions
- Follow existing naming conventions

## Recent Improvements

### Architecture
- ✅ Consolidated duplicate message listeners in background.js
- ✅ Centralized phone sanitization functions
- ✅ Fixed withTimeout usage (removed duplicate implementations)

### Security
- ✅ Fixed postMessage security (use window.location.origin)
- ✅ Added origin validation to all message listeners
- ✅ Fixed NetSniffer to use only WhatsApp-specific patterns

### Performance
- ✅ Reduced NetSniffer memory limit from 10000 to 5000
- ✅ Implemented age-based cleanup
- ✅ Added periodic cleanup every 5 minutes

### Phone Validation
- ✅ Fixed Brazilian phone normalization
- ✅ Proper handling of landline vs mobile
- ✅ Support for 10-digit landline format

## Contributing

When contributing:
1. Follow existing code structure
2. Add JSDoc comments
3. Test manually before submitting
4. Update documentation if needed
5. Keep changes minimal and focused

## License

MIT License - See LICENSE file for details
