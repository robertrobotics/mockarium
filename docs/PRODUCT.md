# Mockarium

Mockarium is a local-first desktop application for testing AI agents against simulated MCP servers. Developers define safe mock systems, connect an existing MCP-compatible client, and inspect its actual tool interactions.

## First release

The first release provides workspaces, a customizable Email mock, a visual Database Studio with an editable relational model, a Calendar Studio with a drag-and-drop week planner, and a real-time execution inspector. Email Studio configures the mailbox identity, messages, folders, and contacts that an agent can discover and use. All MCP servers start only on loopback and never connect to production services. The Database Studio uses safe, validated record operations instead of exposing SQL. The app is intended for manual testing with external MCP clients; it does not build or host an AI agent.

## Product principles

- Local data and configuration; no account or telemetry.
- Mock operations stay isolated from production services.
- Visible, observable tool calls rather than hidden model reasoning.
- GUI-first workflows, with clear connection details and errors.
- Reproducible mock state and deterministic behavior.

## Initial users and workflow

People using MCP-based agents can create a workspace, shape sample business data in Database Studio, customize an email mailbox in Email Studio, plan a realistic week in Calendar Studio, connect an agent to the local MCP endpoint, inspect the real request and response, and restore starter mock data.

## Roadmap boundaries

File Storage, a custom mock-server builder, and scenario testing remain future milestones.
