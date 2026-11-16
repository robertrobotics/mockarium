# Security Policy

## Scope

Mockarium runs local MCP services and stores workspace data on the user's machine. The initial release does not connect to production business services.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository's GitHub security advisories feature. Include affected versions, impact, and steps to reproduce. Do not publish sensitive details before a fix is available.

## Security boundaries

MCP listeners should remain loopback-only, validate request origins, and expose mock operations only. Never include credentials, real customer data, or sensitive workspace contents in bug reports.
