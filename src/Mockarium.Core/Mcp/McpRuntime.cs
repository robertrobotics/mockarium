using System.Collections.Concurrent;
using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Mockarium.Core.Storage;

namespace Mockarium.Core.Mcp;

public sealed class McpRuntime(MockariumStore store, ILoggerFactory loggerFactory) : IAsyncDisposable
{
    private sealed record RunningServer(string WorkspaceId, string Endpoint, WebApplication Application);

    private readonly ConcurrentDictionary<string, RunningServer> _running = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly ILogger _logger = loggerFactory.CreateLogger<McpRuntime>();
    private bool _disposed;

    public event EventHandler<ExecutionEvent>? ExecutionCaptured;

    public MockServer? GetServer(string workspaceId, string serverId)
    {
        var server = store.GetServer(workspaceId, serverId);
        if (server is null) return null;
        return _running.TryGetValue(serverId, out var running) && running.WorkspaceId == workspaceId
            ? server with { Running = true, Endpoint = running.Endpoint }
            : server;
    }

    public IReadOnlyList<Tool> GetTools(string workspaceId, string serverId)
    {
        var server = store.GetServer(workspaceId, serverId)
            ?? throw new InvalidOperationException("Mock server was not found in this workspace.");
        return CreateTools(server).Select(tool => tool.ProtocolTool).ToArray();
    }

    public async Task<MockServer> StartAsync(string workspaceId, string serverId, CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var server = store.GetServer(workspaceId, serverId)
                ?? throw new InvalidOperationException("Mock server was not found in this workspace.");
            if (_running.TryGetValue(serverId, out var existing))
                return server with { Running = true, Endpoint = existing.Endpoint };

            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
            {
                ApplicationName = typeof(McpRuntime).Assembly.GetName().Name,
                EnvironmentName = "Production",
                Args = []
            });
            builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
            builder.Services.AddMcpServer(options =>
            {
                options.ServerInfo = new Implementation { Name = $"mockarium-{server.Type}", Version = "0.1.0" };
            }).WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
              .WithTools(CreateTools(server));
            var app = builder.Build();
            app.Use(async (http, next) =>
            {
                if (!IsAllowedHost(http.Request.Host.Host) ||
                    !IsAllowedOrigin(http.Request.Headers.Origin.ToString()))
                {
                    http.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await http.Response.WriteAsync("Forbidden host or origin.");
                    return;
                }
                await next();
            });
            app.MapMcp("/mcp");
            try
            {
                await app.StartAsync(cancellationToken).ConfigureAwait(false);
                var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses;
                var address = addresses?.SingleOrDefault()
                    ?? throw new InvalidOperationException("Could not determine the MCP server address.");
                var endpoint = $"{address.TrimEnd('/')}/mcp";
                if (!_running.TryAdd(serverId, new RunningServer(workspaceId, endpoint, app)))
                    throw new InvalidOperationException("The MCP server is already running.");
                return server with { Running = true, Endpoint = endpoint };
            }
            catch
            {
                await app.DisposeAsync().ConfigureAwait(false);
                throw;
            }
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    public async Task<MockServer> StopAsync(string workspaceId, string serverId, CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var server = store.GetServer(workspaceId, serverId)
                ?? throw new InvalidOperationException("Mock server was not found in this workspace.");
            if (_running.TryGetValue(serverId, out var running))
            {
                if (running.WorkspaceId != workspaceId) throw new InvalidOperationException("Server workspace mismatch.");
                await StopCoreAsync(serverId, running, cancellationToken).ConfigureAwait(false);
            }
            return server;
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    public async Task StopWorkspaceAsync(string workspaceId, CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var (id, running) in _running.Where(pair => pair.Value.WorkspaceId == workspaceId).ToArray())
                await StopCoreAsync(id, running, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    private async Task StopCoreAsync(string id, RunningServer running, CancellationToken cancellationToken)
    {
        await running.Application.StopAsync(cancellationToken).ConfigureAwait(false);
        await running.Application.DisposeAsync().ConfigureAwait(false);
        _running.TryRemove(id, out _);
    }

    private IReadOnlyList<McpServerTool> CreateTools(MockServer server)
    {
        var context = new ToolContext(store, server.WorkspaceId, server.Name, Publish, _logger);
        return server.Type switch
        {
            "email" => ToolContext.CreateTools(new EmailTools(context)),
            "database" => ToolContext.CreateTools(new DatabaseTools(context)),
            "calendar" => ToolContext.CreateTools(new CalendarTools(context)),
            _ => throw new InvalidOperationException("Unsupported mock server type.")
        };
    }

    private void Publish(ExecutionEvent entry) => ExecutionCaptured?.Invoke(this, entry);

    public static bool IsAllowedHost(string? host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "[::1]", StringComparison.OrdinalIgnoreCase);

    public static bool IsAllowedOrigin(string? origin)
    {
        if (string.IsNullOrEmpty(origin)) return true;
        return Uri.TryCreate(origin, UriKind.Absolute, out var parsed) &&
            (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps) &&
            IsAllowedHost(parsed.Host) && string.IsNullOrEmpty(parsed.UserInfo) &&
            parsed.AbsolutePath == "/" && string.IsNullOrEmpty(parsed.Query) && string.IsNullOrEmpty(parsed.Fragment);
    }

    public async ValueTask DisposeAsync()
    {
        await _lifecycle.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            foreach (var (id, running) in _running.ToArray())
                await StopCoreAsync(id, running, CancellationToken.None).ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _lifecycle.Release();
        }
    }
}
