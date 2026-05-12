/**
 * Usage Example: ConversationMemory Module
 */

// ============================================
// BACKEND USAGE
// ============================================

/* 
const ConversationMemory = require('./ai/memory/ConversationMemory');

const memory = new ConversationMemory({
  storageDir: './data/memory',
  enablePersistence: true,
  openaiConfig: { apiKey: process.env.OPENAI_API_KEY }
});

await memory.init();

// Add messages
await memory.addMessage('5511999999999', {
  role: 'user',
  content: 'Olá, gostaria de informações'
});

// Get context
const context = memory.getContext('5511999999999');
const formatted = memory.formatForPrompt(context, 2000);
*/

// ============================================
// EXTENSION USAGE
// ============================================

/*
await window.conversationMemory.addMessage(chatId, {
  role: 'user',
  content: userMessage
});

const context = window.conversationMemory.getContext(chatId);
const formatted = window.conversationMemory.formatForPrompt(context, 2000);
*/

console.log('ConversationMemory usage examples loaded');
