# Architecture

## Process boundaries

- **Electron main** owns SQLite, workspace services, mock state, and MCP HTTP listeners.
- **Preload** exposes a small, typed IPC API. Renderer Node integration is disabled and context isolation is enabled.
- **React renderer** presents workspaces, server controls, connection details, and execution events; it does not access the filesystem or database.
- **Email domain service** owns deterministic fixtures and stateful operations.
- **MCP runtime** publishes Email tools using the official TypeScript SDK and Streamable HTTP on `127.0.0.1`.
- **Request lifecycle** uses a fresh stateless SDK transport and tool server for each HTTP POST, as required by the SDK's stateless transport; workspace state remains in SQLite across requests. A request-scoped GET event stream is also supported for compatibility with MCP clients such as Inspector.

## Persistence

SQLite stores workspaces, configured mock servers, email data, and bounded execution history. Rows are associated with a workspace. Reset restores seeded email data while retaining the execution history for auditability.

## Runtime events

The MCP tool handler records actual arguments, result or error, and duration. Events are stored locally and pushed to the renderer using a narrow IPC event channel. The renderer does not synthesize tool activity.

## Security boundaries

- No connection to production email or other business services.
- Streamable HTTP listeners bind to loopback only and validate incoming `Origin` headers.
- IPC payloads are runtime-validated.
- Renderer has no Node integration and cannot access local files directly.
- Tool parameters are validated; user-provided code is not executed.
- Workspace information is not sent to external services.

## Transport and interoperability

The initial transport is MCP Streamable HTTP. Connection information is shown for an external MCP client. The release should only claim client compatibility that has been tested; MCP Inspector is used for protocol-level verification and is not an agent host.
