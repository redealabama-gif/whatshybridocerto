# Contributing to WhatsHybrid

Thank you for considering contributing to WhatsHybrid! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Commit Message Format](#commit-message-format)

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inspiring community for all.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/redealabama-gif/git.git
   cd whatshybrid
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   ```bash
   # Backend
   cp whatshybrid-backend/.env.example whatshybrid-backend/.env
   # Edit .env and add your configuration
   ```

4. **Run tests to verify setup**
   ```bash
   npm test
   ```

## Development Workflow

### Running the Project

**Backend:**
```bash
cd whatshybrid-backend
npm run dev
```

**Extension:**
1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `whatshybrid-extension` directory

### Before Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run linters and tests:
   ```bash
   npm run lint
   npm run format:check
   npm test
   ```

## Code Style

We use ESLint and Prettier to maintain consistent code style.

### ESLint Rules

- `no-empty`: Warn on empty catch blocks
- `no-unused-vars`: Warn on unused variables
- `no-console`: Off for extension, warn for backend
- `semi`: Require semicolons
- `quotes`: Use single quotes

### Prettier Configuration

- Single quotes
- Trailing commas (ES5)
- Print width: 100
- Tab width: 2 spaces
- Semicolons: required

### Running Formatters

```bash
# Check formatting
npm run format:check

# Auto-fix formatting
npm run format

# Run linter
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

### Pre-commit Hooks

We use Husky to run lint-staged on commit. This will automatically:
- Run ESLint with auto-fix
- Run Prettier to format code

## Testing Guidelines

### Test Structure

```
whatshybrid-backend/
  src/
    __tests__/
      contracts/      # API contract tests
      integration/    # Integration tests
      unit/          # Unit tests

e2e/                 # End-to-end tests
```

### Writing Tests

#### Unit Tests
```javascript
describe('ModuleName', () => {
  test('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = moduleFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

#### Contract Tests
- Validate request/response schemas using JSON Schema
- Use AJV for validation
- See `whatshybrid-backend/src/__tests__/contracts/` for examples

#### E2E Tests
- Use Playwright for browser automation
- Focus on critical user flows
- See `e2e/` directory for examples

### Running Tests

```bash
# Run all tests
npm test

# Run backend tests
cd whatshybrid-backend && npm test

# Run with coverage
npm test -- --coverage

# Run contract tests only
npm run test:contracts

# Run E2E tests
npm run test:e2e

# Run E2E tests in UI mode
npm run test:e2e:ui
```

## Pull Request Process

1. **Update documentation** if you're changing functionality

2. **Add/update tests** for your changes

3. **Run the full test suite** and ensure all tests pass

4. **Run linters** and fix any issues

5. **Update CHANGELOG** with your changes (under "Unreleased" section)

6. **Create a Pull Request** with:
   - Clear title describing the change
   - Detailed description of what and why
   - Reference to related issues
   - Screenshots for UI changes

7. **Request review** from maintainers

8. **Address review feedback**

### PR Checklist

Before submitting, ensure:
- [ ] All tests passing
- [ ] Lint checks passing
- [ ] Format checks passing
- [ ] No empty catch blocks
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Commit messages follow convention

## Commit Message Format

We follow the Conventional Commits specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(ai): add support for GPT-4 model

Implement GPT-4 integration with fallback to GPT-3.5
when API quota is exceeded.

Closes #123
```

```
fix(logger): handle undefined error messages

Previously logger would crash when error.message was undefined.
Now it safely handles this case.
```

```
docs: update API documentation for v7.9

Add documentation for new safety filter endpoints
and update response schemas.
```

## Logger Usage

Always use the structured logger instead of console.log:

### Extension
```javascript
// Get logger instance
const logger = window.WHLogger.child('ModuleName');

// Use appropriate log levels
logger.debug('Detailed debugging info', { data: value });
logger.info('General information', { status: 'ok' });
logger.warn('Warning condition', { error: error.message });
logger.error('Error occurred', { error: error.message });
```

### Backend
```javascript
const logger = require('../config/logger');

logger.info('Server started', { port: 3000 });
logger.warn('Rate limit exceeded', { ip: req.ip });
logger.error('Database error', { error: error.message });
```

### Never Do This

```javascript
// BAD - Don't use console.log
console.log('Something happened');

// BAD - Don't have empty catch blocks
try {
  // code
} catch (e) {}

// BAD - Don't log full error stack in warn level
logger.warn('Error', { error: error });
```

## Error Handling

Always handle errors properly:

```javascript
try {
  // code that might fail
} catch (error) {
  logger.error('Operation failed', { 
    error: error.message,
    context: 'additional context'
  });
  
  // Provide fallback or rethrow if needed
  return fallbackValue;
}
```

## Questions?

If you have questions, please:
1. Check existing documentation
2. Search closed issues
3. Open a new issue with your question

Thank you for contributing! 🚀
