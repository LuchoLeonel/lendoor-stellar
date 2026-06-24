# Lendoor Backend

NestJS API server for the Lendoor uncollateralized lending protocol.

## Quick Start

```bash
# Install dependencies
yarn install

# Set up environment
cp .env.example .env  # Edit with your values

# Run in development
yarn dev

# Run tests
yarn test
```

## Architecture

Hexagonal architecture (ports & adapters) with NestJS modules.

```
src/
  domain/          # Entities, ports, pure business logic
  infrastructure/  # HTTP controllers, queue processors, blockchain adapter
  [modules]/       # Feature modules (auth, loan, user, notification, etc.)
```

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for full details.

## Key Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start in dev mode with hot reload |
| `yarn build` | Compile TypeScript |
| `yarn start:prod` | Start production server |
| `yarn test` | Run all 397 tests |
| `yarn lint` | ESLint + auto-fix |

## Environment Variables

See `src/config/env.ts` for all variables with validation. Required:
- `POSTGRES_*` — Database connection
- `ETH_RPC_URL`, `ETH_LOAN_MANAGER`, `ETH_PRIVATE_KEY` — Blockchain
- `REDIS_HOST`, `REDIS_PORT` — Cache + queues
- `SELF_SCOPE`, `BACKEND_URL` — Identity verification

## Documentation

- [Architecture](../docs/ARCHITECTURE.md)
- [API Reference](../docs/API.md)
- [Backend Guide](../docs/BACKEND.md)
- [Database](../docs/DATABASE.md)
- [Deployment](../docs/DEPLOYMENT.md)
- [Monitoring](../docs/MONITORING.md)
- [Runbook](../RUNBOOK.md)
