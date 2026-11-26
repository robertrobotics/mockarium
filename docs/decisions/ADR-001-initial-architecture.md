# ADR-001: Initial architecture

## Status

Superseded by the .NET 11 desktop architecture in
[docs/ARCHITECTURE.md](../ARCHITECTURE.md). Kept for historical context.

## Context

Mockarium needs a local desktop UI, isolated persistence, and an external MCP connection without an online account or a locally hosted model.

## Decision

Use Electron, React, TypeScript, SQLite, the official MCP TypeScript SDK, and Streamable HTTP. Keep the database and MCP runtime in Electron main, expose only validated operations through preload IPC, and bind MCP listeners to `127.0.0.1`. Begin with one stateful Email connector and defer other connector families.

The MCP endpoint uses stateless Streamable HTTP. Each POST is served by a fresh SDK transport and MCP server instance, while business state and execution history remain persistent in SQLite. A request-scoped GET event stream is supported for interoperability with clients that still open the legacy Streamable HTTP event stream.

## Consequences

- Tool calls from external clients can be observed at the actual server boundary.
- The renderer does not receive unrestricted Node or filesystem access.
- Local MCP HTTP needs origin validation and careful lifecycle management.
- Native SQLite must be rebuilt or packaged for the Electron runtime.
- MCP Inspector verification demonstrates protocol behavior, not compatibility with every agent host.
