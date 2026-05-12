// utils/data-normalizer.js - Data Normalization Utilities

/**
 * Normalize phone number format
 * @param {string} phone - Phone number to normalize
 * @returns {string} - Normalized phone number
 */
function normalizePhone(phone) {
    if (!phone) return '';
    // Remove spaces, maintain + at the beginning
    return phone.replace(/\s+/g, '').trim();
}

/**
 * Normalize extraction data before saving
 * @param {Object} data - Raw extraction data
 * @returns {Object} - Normalized data with deduplicated members
 */
function normalizeExtractionData(data) {
    if (!data || !data.members) return data;
    
    // Deduplicate by phone or name
    const uniqueMembers = [];
    const seen = new Set();
    
    for (const member of data.members) {
        const key = member.phone || member.name;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueMembers.push({
                ...member,
                phone: normalizePhone(member.phone),
                name: member.name?.trim() || 'Sem nome'
            });
        }
    }
    
    return {
        ...data,
        members: uniqueMembers,
        totalMembers: uniqueMembers.length
    };
}

/**
 * Validate member data
 * @param {Object} member - Member object to validate
 * @returns {boolean} - True if member is valid
 */
function isValidMember(member) {
    if (!member) return false;
    
    // Must have either phone or name
    if (!member.phone && !member.name) return false;
    
    // Name should not be empty after trim
    if (member.name && member.name.trim().length === 0) return false;
    
    return true;
}

/**
 * Clean and validate array of members
 * @param {Array} members - Array of member objects
 * @returns {Array} - Cleaned array of valid members
 */
function cleanMembersArray(members) {
    if (!Array.isArray(members)) return [];
    
    return members.filter(isValidMember);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizePhone,
        normalizeExtractionData,
        isValidMember,
        cleanMembersArray
    };
}
