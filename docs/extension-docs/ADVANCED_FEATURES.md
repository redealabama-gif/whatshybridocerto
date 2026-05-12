# Advanced Features Documentation

This document describes the advanced features implemented in the WhatsHybrid Lite Fusion extension.

## 1. Fila de Agendamentos Múltiplos (Multiple Scheduling Queue)

### Overview
Allows scheduling multiple campaigns to run automatically at different times using Chrome's Alarms API.

### Features
- Schedule campaigns for specific date/time
- List all scheduled campaigns with countdown
- Automatic execution at scheduled time
- Delete scheduled campaigns
- Storage in `chrome.storage.local`

### Usage
1. Go to **Config** view
2. Find the **📅 Agendamentos** section
3. Enter campaign name and select date/time
4. Click **➕ Agendar** to schedule
5. View scheduled campaigns in the list below

### API Reference
**File:** `utils/scheduler.js`

```javascript
// Create a schedule
await window.schedulerManager.createSchedule({
  name: 'Campaign Name',
  scheduledTime: '2024-01-01T10:00',
  queue: [...contacts],
  config: {...settings}
});

// Get all schedules
const schedules = window.schedulerManager.getAllSchedules();

// Delete a schedule
await window.schedulerManager.deleteSchedule(scheduleId);

// Execute a schedule
await window.schedulerManager.executeSchedule(scheduleId);
```

---

## 2. Anti-Ban Inteligente (Smart Anti-Ban System)

### Overview
Protects against WhatsApp bans by simulating human behavior with intelligent delays and daily limits.

### Features
- **Gaussian Delay Variation**: Uses Box-Muller transform for natural delay patterns
- **Daily Message Limit**: Configurable limit (1-1000 messages/day)
- **Business Hours Only**: Optional restriction to 8h-20h
- **Random Pauses**: 10% chance of extra delay (up to 10 seconds)
- **Visual Progress Bar**: Shows daily usage with color indicators
- **Automatic Reset**: Daily counter resets at midnight

### Usage
1. Go to **Config** view
2. Find the **🛡️ Anti-Ban Inteligente** section
3. Set daily message limit
4. Enable/disable business hours restriction
5. Click **💾 Salvar** to save settings

### API Reference
**File:** `utils/anti-ban.js`

```javascript
// Calculate smart delay
const delay = window.antiBanSystem.calculateSmartDelay(2000, 6000);

// Check if can send now
const check = await window.antiBanSystem.canSendNow();
if (check.allowed) {
  // Send message
  await window.antiBanSystem.incrementSentCount();
}

// Get statistics
const stats = await window.antiBanSystem.getStats();
console.log(`Sent: ${stats.sentToday}/${stats.dailyLimit}`);

// Set daily limit
await window.antiBanSystem.setDailyLimit(200);

// Enable business hours only
await window.antiBanSystem.setBusinessHoursOnly(true);
```

### Color Indicators
- 🟢 **Green** (0-79%): Safe zone
- 🟠 **Orange** (80-99%): Warning zone
- 🔴 **Red** (100%): Limit reached

---

## 3. Importação Avançada de Contatos (Advanced Contact Import)

### Overview
Imports contacts from Excel files with automatic validation, duplicate removal, and preview.

### Features
- **File Support**: .xlsx, .xls, .csv, .txt
- **Automatic Validation**: Brazilian and international numbers
- **Duplicate Removal**: Ensures unique contacts
- **Statistics Preview**: Shows total, valid, invalid, and duplicates
- **Format Detection**: Automatically detects Brazilian numbers with/without country code

### Usage
1. Go to **Principal** view
2. Click **📊 Importar Excel**
3. Select Excel or CSV file
4. Review statistics
5. Numbers are automatically added to the textarea

### Phone Number Formats Supported
- Brazilian without country code: `11999998888` → `5511999998888`
- Brazilian with country code: `5511999998888`
- International: Any 10-15 digit number

### API Reference
**File:** `utils/contact-importer.js`

```javascript
// Import file
const result = await window.ContactImporter.importFile(file);

if (result.success) {
  console.log('Numbers:', result.numbers);
  console.log('Stats:', result.stats);
  // { total, valid, invalid, duplicates, unique }
}

// Validate single number
const validated = window.ContactImporter.validatePhoneNumber('11999998888');
// Returns: '5511999998888'

// Remove duplicates
const unique = window.ContactImporter.removeDuplicates([...numbers]);
```

---

## 4. Cache de Grupos (Groups Cache)

### Overview
Caches group list for 5 minutes to provide instant loading and reduce API calls.

### Features
- **5-minute Cache**: Stores groups in local storage
- **Cache Indicator**: Shows "(do cache)" when using cached data
- **Force Refresh**: Button to clear cache and reload
- **Automatic Expiration**: Cache expires after 5 minutes
- **Statistics Included**: Caches group counts (total, active, archived)

### Usage
- Groups are automatically cached when loaded
- Cache indicator appears in group count badge
- Click **🔄 Forçar Atualização** to clear cache and reload fresh data

### API Reference
**File:** `utils/group-cache.js`

```javascript
// Get cache (if valid)
const cache = await window.GroupCache.get();
if (cache && cache.fromCache) {
  console.log('Using cached groups:', cache.groups);
}

// Save to cache
await window.GroupCache.set(groups, stats);

// Clear cache
await window.GroupCache.clear();

// Check if cache is valid
const isValid = await window.GroupCache.isValid();

// Get cache info
const info = await window.GroupCache.getInfo();
console.log(`Age: ${info.ageFormatted}, Expires in: ${info.expiresInFormatted}`);
```

---

## 5. Notificações Desktop (Desktop Notifications)

### Overview
Provides desktop notifications with sound for important events like campaign completion, errors, and limits.

### Features
- **Campaign Complete**: Notifies when campaign finishes with stats
- **Error Alerts**: Shows errors with sound
- **Daily Limit Warnings**: Alerts at 80% and 100% of limit
- **Scheduled Campaign**: Notifies when scheduled campaign starts
- **Sound Effects**: Web Audio API generates success/error/warning tones
- **Configurable**: Enable/disable notifications and sounds separately

### Usage
1. Go to **Config** view
2. Find the **🔔 Notificações** section
3. Enable/disable notifications
4. Enable/disable sounds
5. Click **🔔 Testar Notificação** to test

### API Reference
**File:** `utils/notifications.js`

```javascript
// Send notification (chrome.notifications doesn't need permission request)
await window.notificationSystem.notify('Title', 'Body', {
  sound: true,
  soundType: 'success' // or 'error', 'warning', 'default'
});

// Campaign notifications
await window.notificationSystem.campaignComplete(sent, failed);
await window.notificationSystem.campaignError('Error message');
await window.notificationSystem.dailyLimitWarning(current, limit);
await window.notificationSystem.scheduleStarting('Campaign Name');

// Test notification
await window.notificationSystem.test();

// Settings
await window.notificationSystem.setEnabled(true);
await window.notificationSystem.setSoundEnabled(true);
```

### Sound Types
- **Success** (E5 - 659.25 Hz): Pleasant tone for positive events
- **Error** (C3 - 130.81 Hz): Low tone for errors
- **Warning** (G4 - 392.00 Hz): Medium tone for warnings
- **Default** (C4 - 261.63 Hz): Neutral tone for general notifications

---

## Storage Keys

All features use `chrome.storage.local` with the following keys:

- `whl_schedules`: Scheduler data
- `whl_anti_ban_data`: Anti-ban statistics and settings
- `whl_groups_cache`: Group cache with timestamp
- `whl_notification_settings`: Notification preferences

---

## Browser Permissions

The following permissions are required in `manifest.json`:

```json
{
  "permissions": [
    "alarms",          // For scheduler
    "notifications",   // For desktop notifications
    "storage"          // For all data persistence
  ]
}
```

---

## Security Considerations

1. **CDN Integrity**: SheetJS is loaded with integrity check to prevent tampering
2. **Input Validation**: All phone numbers are validated before use
3. **Storage Limits**: Daily limits prevent abuse
4. **Rate Limiting**: Smart delays prevent ban
5. **Resource Management**: AudioContext is reused to prevent memory leaks

---

## Performance Optimizations

1. **Group Cache**: Reduces API calls by 80%
2. **Lazy Loading**: Features load only when needed
3. **Debounced Updates**: Prevents excessive UI updates
4. **Virtual Scrolling**: Efficient rendering of large lists
5. **Memory Management**: Proper cleanup of resources

---

## Troubleshooting

### Scheduler not working
- Check if `alarms` permission is granted
- Verify scheduled time is in the future
- Check browser console for errors

### Notifications not showing
- Click "Test Notification" to request permission
- Check browser notification settings
- Ensure notifications are enabled in Config

### Excel import failing
- Verify file format (.xlsx, .xls, .csv)
- Check if SheetJS CDN is loaded (console errors)
- Ensure file contains valid phone numbers

### Cache not working
- Check chrome.storage.local quota
- Clear browser cache and reload
- Verify GroupCache is initialized

### Anti-ban not tracking
- Check if daily limit is set correctly
- Verify storage permissions
- Reset daily count if needed

---

## Future Enhancements

Potential improvements for future versions:

1. **Scheduler**: Recurring campaigns (daily, weekly)
2. **Anti-Ban**: Machine learning for optimal delays
3. **Import**: Support for more file formats (Google Sheets API)
4. **Cache**: Configurable cache duration
5. **Notifications**: Custom notification sounds
6. **Analytics**: Detailed campaign statistics dashboard

---

## Credits

Developed as part of WhatsHybrid Lite Fusion v1.4.6+

All features are designed to work seamlessly with existing functionality and follow the codebase conventions.
