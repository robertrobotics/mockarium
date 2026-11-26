# Mockarium

Mockarium is a local-first desktop application for testing external AI agents
against simulated MCP services. Developers shape realistic mock data, connect
an MCP-compatible client, and inspect its actual tool interactions; Mockarium
does not build or host an AI agent.

## Desktop direction

The application targets .NET 11 only, with WPF on Windows and Avalonia on
macOS/Linux. Shared MVVM and domain layers keep behavior consistent across the
two desktop clients.

## Product principles

- Local data and configuration; no accounts or telemetry.
- Mock operations remain isolated from real business services.
- Visible tool calls rather than hidden model reasoning.
- GUI-first workflows, with clear connection details and errors.
- Reproducible mock state and deterministic behavior.
- Preserve existing workspaces across application upgrades.

## Core workflow

Create a workspace, configure the Email, Database, or Calendar mock, connect an
external MCP client to the loopback endpoint, inspect the real request and
response, and restore starter mock data when needed.

## Scope and status

Email, Database, Calendar, and Live Inspector are implemented in the .NET
clients. Cross-platform packaging and packaged user-data path parity still
require verification. MCP Inspector discovered all three tool catalogs and
called one tool per studio without schema portability warnings. A direct
TypeScript SDK probe discovered and called all 22 tools.

Future work may include File Storage, a custom mock-server builder, and
scenario automation; those features are not part of the current release.
