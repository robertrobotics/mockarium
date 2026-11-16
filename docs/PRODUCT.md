# Mockarium

Mockarium is a local-first desktop application for testing AI agents against simulated MCP servers. Developers define safe mock systems, connect an existing MCP-compatible client, and inspect its actual tool interactions.

## First release

The initial vertical slice provides workspaces, a stateful Email mock MCP server, a real-time execution inspector, and resettable local data. The Email server starts only on loopback and never connects to a real email provider. The first release is intended for manual testing with external MCP clients; it does not build or host an AI agent.

## Product principles

- Local data and configuration; no account or telemetry.
- Mock operations stay isolated from production services.
- Visible, observable tool calls rather than hidden model reasoning.
- GUI-first workflows, with clear connection details and errors.
- Reproducible mock state and deterministic behavior.

## Initial users and workflow

Developers using MCP-based agents can create a workspace, start the Email server, copy its MCP endpoint into a compatible client, exercise search and send operations, inspect the real request and response, and reset the mock inbox.

## Roadmap boundaries

Database and file-storage connectors, a custom tool builder, and scenario testing are future milestones, not features of the initial vertical slice.
