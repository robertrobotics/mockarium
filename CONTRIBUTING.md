# Contributing

Contributions to Mockarium are welcome.

## Development setup

Install the .NET 11 SDK. Run the cross-platform Avalonia client with
`dotnet run --project src/Mockarium.Desktop`; on Windows, run the native WPF
client with `dotnet run --project src/Mockarium.Wpf`.

Before submitting changes, run `dotnet build -c Release` and
`dotnet test -c Release --no-build` from the repository root. Keep changes focused,
add tests for behavior, and document user-visible changes.

Keep tests isolated from live application data: use an in-memory store or a
private temporary directory. The checked-in SQLite fixture is for backward
compatibility; do not regenerate it using the current store.

## Project direction

Mock services must remain isolated from real business systems. Do not add telemetry or external data transmission by default. See the architecture and product documents for boundaries and current scope.

## Changes

Use clear commit messages and describe user impact, validation performed, and any limitations in pull requests. Report security issues privately as described in `SECURITY.md`.
