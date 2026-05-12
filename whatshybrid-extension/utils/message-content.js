/**
 * Message Content Detection Utilities
 * Shared utilities for detecting and handling message content types
 */

window.WHL_MessageContentUtils = {
  /**
   * Checks if content is a base64 encoded image
   * @param {string} content - Content to check
   * @returns {boolean} - True if content is base64 image
   */
  isBase64Image(content) {
    if (!content || typeof content !== 'string') return false;
    return content.startsWith('/9j/') || 
           content.startsWith('iVBOR') || 
           content.startsWith('data:image');
  },

  /**
   * Checks if content is a base64 encoded video
   * @param {string} content - Content to check
   * @returns {boolean} - True if content is base64 video
   */
  isBase64Video(content) {
    if (!content || typeof content !== 'string') return false;
    return content.startsWith('data:video');
  },

  /**
   * Checks if content is a base64 encoded audio
   * @param {string} content - Content to check
   * @returns {boolean} - True if content is base64 audio
   */
  isBase64Audio(content) {
    if (!content || typeof content !== 'string') return false;
    return content.startsWith('data:audio');
  },

  /**
   * Detects message type based on content
   * @param {string} body - Message content
   * @param {string} originalType - Original message type
   * @returns {string} - Detected type ('image', 'video', 'audio', or original/text)
   */
  detectMessageType(body, originalType) {
    if (!body || typeof body !== 'string') return originalType || 'text';
    
    // Detect images
    if (this.isBase64Image(body)) return 'image';
    
    // Detect videos
    if (this.isBase64Video(body)) return 'video';
    
    // Detect audio
    if (this.isBase64Audio(body)) return 'audio';
    
    // Return original or default to text
    return originalType || 'text';
  },

  /**
   * Converts base64 content to data URL
   * @param {string} content - Base64 content
   * @returns {string|null} - Data URL or null if not convertible
   */
  toDataUrl(content) {
    if (!content || typeof content !== 'string') return null;
    
    // Already a data URL
    if (content.startsWith('data:')) return content;
    
    // JPEG base64
    if (content.startsWith('/9j/')) {
      return `data:image/jpeg;base64,${content}`;
    }
    
    // PNG base64
    if (content.startsWith('iVBOR')) {
      return `data:image/png;base64,${content}`;
    }
    
    return null;
  },

  /**
   * Gets the media type from content
   * @param {string} content - Content to analyze
   * @returns {string|null} - Media type ('jpeg', 'png', 'gif', etc.) or null
   */
  getMediaType(content) {
    if (!content || typeof content !== 'string') return null;
    
    if (content.startsWith('/9j/')) return 'jpeg';
    if (content.startsWith('iVBOR')) return 'png';
    if (content.startsWith('R0lGOD')) return 'gif';
    
    // Extract from data URL
    const dataUrlMatch = content.match(/^data:(\w+)\/(\w+);/);
    if (dataUrlMatch) {
      return dataUrlMatch[2]; // Returns the subtype (jpeg, png, mp4, etc.)
    }
    
    return null;
  }
};

// Export for Node.js testing if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.WHL_MessageContentUtils;
}
