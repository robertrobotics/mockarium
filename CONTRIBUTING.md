# Contributing

Contributions to Mockarium are welcome.

## Development setup

Install Node.js 22.12+ and pnpm 12, then run `pnpm install` and `pnpm dev`.

Before submitting changes, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Keep changes focused, add tests for behavior, and document user-visible changes.

## Project direction

Mock services must remain isolated from real business systems. Do not add telemetry or external data transmission by default. See the architecture and product documents for boundaries and current scope.

## Changes

Use clear commit messages and describe user impact, validation performed, and any limitations in pull requests. Report security issues privately as described in `SECURITY.md`.
