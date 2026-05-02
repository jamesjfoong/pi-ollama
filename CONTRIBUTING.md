# Contributing to pi-ollama

Thank you for considering a contribution! This project keeps Ollama model management zero-maintenance for [pi](https://pi.dev) users.

## Quick Start

```bash
git clone https://github.com/jamesjfoong/pi-ollama.git
cd pi-ollama
npm install
```

## Project Architecture

```
extensions/
├── index.ts         # Entry point — bootstraps config, discovery, commands
├── types.ts         # Shared TypeScript interfaces
├── config.ts        # Config resolution (env → file → fallback → defaults)
├── discovery.ts     # HTTP discovery (/v1/models, /api/tags) and filtering
├── cache.ts         # Disk cache for discovered models
├── provider.ts      # Provider registration state management
├── setup-wizard.ts  # Interactive /ollama-setup TUI logic
├── commands.ts      # Command registration (/ollama-setup, /ollama-refresh, /ollama-status)
└── logger.ts        # Centralized logging utility
```

## Workflow

1. **Create a branch** for your change.
2. **Write code** following the patterns below.
3. **Run checks**:
   ```bash
   npm run typecheck    # Ensure TypeScript compiles
   npm run test         # Run unit tests
   npm run format:check # Verify formatting
   ```
4. **Open a PR** with a clear description.

### CI Checks

Every PR and push to `main` triggers GitHub Actions that run:

```bash
npm run typecheck
npm run format:check
npm test
```

Make sure all checks pass before requesting a review.

## Coding Guidelines

- **Keep runtime dependency-free.** Only Node.js built-ins in `extensions/`.
- **One concern per file.** Add new logic to the appropriate module; create a new module if it doesn't fit.
- **Preserve backward compatibility.** The `~/.pi/agent/models.json` fallback must keep working.
- **Never hardcode secrets.**
- **Startup resilience.** Discovery failures should warn, not crash.
- **Small, focused diffs.** One logical change per PR.
- **Format with Prettier** before committing (`npm run format`).

## Testing

Tests live in `test/` and use Node's built-in [`node:test`](https://nodejs.org/api/test.html) and [`node:assert`](https://nodejs.org/api/assert.html). We use [`tsx`](https://github.com/privatenumber/tsx) to run TypeScript tests without a build step.

```bash
# Run all tests
npm test

# Run a specific test file
npx tsx --test test/config.test.ts
```

## Release Policy

- Do **not** publish npm releases without explicit maintainer confirmation.
- Use git tags only after manual verification in real pi sessions.
- Update `package.json` version and `README.md` install instructions before tagging.
