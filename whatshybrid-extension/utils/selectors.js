// utils/selectors.js - Centralized WhatsApp Web DOM Selectors
const WASelectors = {
    // Chat List
    CHAT_LIST: '#pane-side',
    CHAT_ITEM: '[data-id]',
    CHAT_TITLE: 'span[title]',
    
    // Main Area
    MAIN_HEADER: '#main header',
    MAIN_CONTAINER: '#main',
    
    // Search
    SEARCH_BOX: '[data-testid="chat-list-search"]',
    SEARCH_CLEAR: '[data-testid="search-clear-btn"]',
    SEARCH_ICON: '[data-testid="search"]',
    
    // Archived
    ARCHIVED_BUTTON: '[data-testid="archived"]',
    BACK_BUTTON: '[data-testid="back"]',
    
    // Modal/Group Info
    GROUP_INFO_HEADER: 'header span[title]',
    MEMBERS_LIST: '[data-testid="participants-list"]',
    MEMBER_ITEM: '[data-testid="cell-frame-container"]',
    
    // Buttons
    CLOSE_BUTTON: '[data-icon="x"]',
    
    // Invalid group indicators (text-based)
    INVALID_TEXTS: [
        'você foi removido', 'you were removed',
        'você saiu', 'you left',
        'grupo excluído', 'group deleted',
        'não é mais participante', 'no longer a participant',
        'este grupo foi excluído', 'this group was deleted',
        'grupo desativado', 'group deactivated',
        'você não faz mais parte', 'you are no longer a member',
        'este grupo não existe mais', 'this group no longer exists'
    ]
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WASelectors;
}
