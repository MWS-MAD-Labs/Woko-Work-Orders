# Woko documentation

This directory contains detailed product, technical, release, and operational documentation. The root [README](../README.md) remains the starting point for developers and operators.

## Product

- [Product requirements document](product/PRD.md) — problem, users, workflows, requirements, success measures, and product boundaries
- [v0.6.0 implementation plan](releases/v0.6.0-plan.md) — Worker role, internal procurement tracking, PIC creation, action-bound attachments, and Drive reliability scope
- [v0.5.1 release notes](releases/v0.5.1.md) — production deployment changes, upgrade notes, and final verification checklist
- [v0.1.0 release notes](releases/v0.1.0.md) — initial delivered scope, deployment prerequisites, and known limitations

## Engineering

- [Architecture overview](architecture.md) — system components, request flow, data ownership, security, jobs, and design decisions

## Operations

- [Docker deployment guide](deployment/docker.md) — production configuration, deployment, TLS, health checks, backups, upgrades, rollback, and troubleshooting
- [Komodo deployment guide](deployment/komodo.md) — Git-backed Stack configuration, protected variables, credentials, webhooks, and production deployment

## Documentation maintenance

Update documentation in the same change whenever behavior, configuration, deployment, or product scope changes:

- Add release-specific changes under `releases/`.
- Keep environment variable guidance synchronized with `apps/api/src/config.ts`, `.env.example`, and `compose.yaml`.
- Keep workflows synchronized with `packages/domain/src/workflow.ts`.
- Keep feature scope synchronized with registered API routes and user-facing web modules.
