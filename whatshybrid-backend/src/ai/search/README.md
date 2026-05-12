# HybridSearch Module

**BM25 + Semantic Search with Reciprocal Rank Fusion (RRF)**

## Overview

HybridSearch combines keyword-based BM25 scoring with semantic embedding search using Reciprocal Rank Fusion (RRF) for optimal retrieval quality. This provides the best of both worlds: exact keyword matching and semantic understanding.

## Features

- ✅ **BM25 Algorithm** - Classic information retrieval with configurable parameters (k1=1.5, b=0.75)
- ✅ **Semantic Search** - Uses EmbeddingProvider for vector-based similarity
- ✅ **Reciprocal Rank Fusion (RRF)** - Combines rankings from multiple methods
- ✅ **Configurable Balance** - Alpha parameter controls keyword vs semantic weight
- ✅ **Full-text Indexing** - TF-IDF statistics and document frequencies
- ✅ **Fallback Support** - Automatically uses bag-of-words if embeddings unavailable
- ✅ **Stats Tracking** - Comprehensive performance monitoring

## Usage

### Basic Example

```javascript
const HybridSearch = require('./HybridSearch');

// Create instance
const search = new HybridSearch({
  alpha: 0.7,  // 70% semantic, 30% keyword
  k: 60,       // RRF constant
  embeddingOptions: {
    apiKey: process.env.OPENAI_API_KEY
  }
});

// Add documents
await search.addDocument({
  id: 'doc1',
  content: 'Machine learning enables systems to learn from data.',
  metadata: { title: 'ML Basics', category: 'AI' }
});

await search.addDocument({
  id: 'doc2',
  content: 'Deep learning uses neural networks for complex patterns.',
  metadata: { title: 'Deep Learning', category: 'AI' }
});

// Search (hybrid by default)
const results = await search.search('neural networks', 5);

console.log(results.results);
// [
//   {
//     docId: 'doc2',
//     score: 0.8234,
//     method: 'rrf',
//     bm25Rank: 1,
//     semanticRank: 1,
//     document: { ... },
//     metadata: { title: 'Deep Learning', ... }
//   }
// ]
```

### Search Methods

```javascript
// Hybrid search (default)
const hybrid = await search.search('query text', 5);

// BM25 only (keyword-based)
const bm25 = await search.search('query text', 5, { bm25Only: true });

// Semantic only (embedding-based)
const semantic = await search.search('query text', 5, { semanticOnly: true });

// Custom alpha (more keyword-focused)
const keywordFocused = await search.search('query text', 5, { alpha: 0.3 });

// Custom alpha (more semantic-focused)
const semanticFocused = await search.search('query text', 5, { alpha: 0.9 });
```

### Document Management

```javascript
// Add document
const result = await search.addDocument({
  id: 'doc3',
  content: 'Document content here...',
  metadata: { title: 'Title', author: 'Author' }
});

console.log(result);
// {
//   id: 'doc3',
//   indexed: true,
//   tokens: 25,
//   uniqueTerms: 20,
//   hasEmbedding: true
// }

// Remove document
const removed = search.removeDocument('doc3');

// Get document
const doc = search.getDocument('doc1');

// Get all document IDs
const ids = search.getDocumentIds();

// Clear all documents
search.clear();
```

### Statistics

```javascript
const stats = search.getStats();

console.log(stats);
// {
//   totalDocuments: 100,
//   totalSearches: 250,
//   bm25Searches: 50,
//   semanticSearches: 50,
//   hybridSearches: 150,
//   avgBM25Score: 2.34,
//   avgSemanticScore: 0.78,
//   avgFusionScore: 0.023,
//   embeddingStats: { ... },
//   indexSize: {
//     documents: 100,
//     terms: 5432,
//     embeddings: 100
//   },
//   averageDocumentLength: 123.5
// }
```

## Configuration Options

```javascript
const search = new HybridSearch({
  // RRF Fusion Parameters
  alpha: 0.7,           // Weight for semantic (0=keyword only, 1=semantic only)
  k: 60,                // RRF rank fusion constant (higher = less sensitive to rank)
  
  // BM25 Parameters
  bm25K1: 1.5,          // Term frequency saturation (1.2-2.0 typical)
  bm25B: 0.75,          // Length normalization (0-1, 0.75 typical)
  
  // Embedding Configuration
  embeddingOptions: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    dimensions: 256,
    cacheSize: 5000
  }
});
```

## Algorithm Details

### BM25 Score

```
BM25(q, d) = Σ IDF(qi) × (f(qi, d) × (k1 + 1)) / (f(qi, d) + k1 × (1 - b + b × |d| / avgdl))

where:
- q = query
- d = document
- qi = query term
- f(qi, d) = term frequency in document
- |d| = document length
- avgdl = average document length
- k1 = term saturation parameter (default 1.5)
- b = length normalization parameter (default 0.75)
- IDF = log((N - df + 0.5) / (df + 0.5) + 1)
  - N = total documents
  - df = document frequency of term
```

### Reciprocal Rank Fusion (RRF)

```
RRF(d) = α × (1 / (k + semantic_rank(d))) + (1 - α) × (1 / (k + bm25_rank(d)))

where:
- α = semantic weight (default 0.7)
- k = rank constant (default 60)
- semantic_rank(d) = rank of document d in semantic results
- bm25_rank(d) = rank of document d in BM25 results
```

### Why RRF?

RRF is more robust than score normalization because:
- **Rank-based**: Uses positions, not raw scores (avoids scale issues)
- **Simple**: No need for score normalization or calibration
- **Effective**: Proven to work well in practice (used in major search systems)
- **Configurable**: k parameter controls rank sensitivity

## Performance Tips

1. **Choose the right alpha**:
   - `alpha=0.7-0.9`: Best for semantic similarity (concepts, synonyms)
   - `alpha=0.3-0.5`: Best for keyword matching (exact terms, names)
   - `alpha=0.5`: Balanced approach

2. **Adjust k parameter**:
   - Lower k (20-40): More sensitive to top ranks
   - Higher k (60-100): More uniform fusion

3. **Use specialized searches**:
   - `bm25Only`: Fast, no API calls, good for exact matches
   - `semanticOnly`: Best for conceptual queries
   - Hybrid: Best overall quality

4. **Index optimization**:
   - Add documents in batches if possible
   - Keep metadata lightweight
   - Remove unused documents regularly

## Extension Version

The extension version (`ai-hybrid-search.js`) includes:
- **IIFE pattern**: Exported as `window.HybridSearch`
- **Chrome storage**: Automatic persistence with `persistToStorage: true`
- **Bag-of-words fallback**: Works without external APIs
- Same API as backend version

```javascript
// Extension usage
const search = new window.HybridSearch({
  alpha: 0.7,
  persistToStorage: true  // Enable chrome.storage.local
});
```

## References

- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- [Text Embeddings](https://platform.openai.com/docs/guides/embeddings)

## Version

**1.0.0** - Initial implementation with BM25, semantic search, and RRF fusion
