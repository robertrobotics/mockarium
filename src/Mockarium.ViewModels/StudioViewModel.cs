using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed record ToolViewModel(string Name, string Description, string Inputs, string Schema);

public abstract partial class StudioViewModel : ObservableObject
{
    private readonly DesktopViewModel _shell;
    private readonly MockariumStore _store;
    private readonly McpRuntime _runtime;
    private readonly IPlatformServices _platform;
    private string? _workspaceId;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusText))]
    [NotifyPropertyChangedFor(nameof(ToggleText))]
    private bool isRunning;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasEndpoint))]
    private string endpoint = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusText))]
    private bool isConfigured;

    [ObservableProperty]
    private bool showTools;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(VisibleTools))]
    [NotifyPropertyChangedFor(nameof(NoMatchingTools))]
    private string toolSearch = "";

    protected StudioViewModel(
        DesktopViewModel shell, MockariumStore store, McpRuntime runtime, IPlatformServices platform,
        string type, string title, string description, string symbol)
    {
        _shell = shell;
        _store = store;
        _runtime = runtime;
        _platform = platform;
        Type = type;
        Title = title;
        Description = description;
        Symbol = symbol;
    }

    public string Type { get; }
    public string Title { get; }
    public string Description { get; }
    public string Symbol { get; }
    public string StatusText => IsRunning ? "Running" : IsConfigured ? "Not running" : "Not set up";
    public string ToggleText => IsRunning ? "Stop server" : "Start server";
    public bool HasEndpoint => !string.IsNullOrEmpty(Endpoint);
    public bool HasWorkspace => _workspaceId is not null;
    public ObservableCollection<ToolViewModel> Tools { get; } = [];
    public IReadOnlyList<ToolViewModel> VisibleTools
    {
        get
        {
            var query = ToolSearch.Trim();
            return query.Length == 0 ? Tools : Tools.Where(tool =>
                tool.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                tool.Description.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                tool.Inputs.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
        }
    }
    public bool NoMatchingTools => VisibleTools.Count == 0;
    protected string WorkspaceId => _workspaceId ?? throw new InvalidOperationException("Choose a workspace first.");
    protected MockariumStore Store => _store;
    protected DesktopViewModel Shell => _shell;
    protected IPlatformServices Platform => _platform;

    internal void LoadWorkspace(string? workspaceId)
    {
        _workspaceId = workspaceId;
        OnPropertyChanged(nameof(HasWorkspace));
        ShowTools = false;
        ToolSearch = "";
        RefreshServer();
        LoadData();
    }

    protected abstract void LoadData();
    protected abstract void ResetData();
    protected virtual void BeforeToggleServer() { }
    internal virtual bool HasUnsavedChanges => false;
    internal virtual void OnAgentExecution(ExecutionEvent entry) { }

    protected async Task RefreshDataAsync() => await _shell.RunAsync(async () =>
    {
        if (HasUnsavedChanges && !await _platform.ConfirmAsync("Discard unsaved changes",
            $"Reload {Title} and discard its unsaved changes?"))
            return;
        LoadData();
    });

    protected Task<bool> ConfirmDiscardAsync(bool hasChanges, string description) =>
        !hasChanges ? Task.FromResult(true) : _platform.ConfirmAsync(
            "Discard unsaved changes", $"Discard the unsaved {description}?");

    protected void RefreshServer()
    {
        var server = _workspaceId is null ? null : _store.ListServers(_workspaceId).FirstOrDefault(candidate => candidate.Type == Type);
        var current = server is null ? null : _runtime.GetServer(server.WorkspaceId, server.Id);
        IsConfigured = current is not null;
        IsRunning = current?.Running ?? false;
        Endpoint = current?.Endpoint ?? "";
        Tools.Clear();
        if (current is not null)
            foreach (var tool in _runtime.GetTools(current.WorkspaceId, current.Id))
            {
                var inputs = tool.InputSchema.TryGetProperty("properties", out var properties)
                    ? string.Join(", ", properties.EnumerateObject().Select(field => field.Name)) : "";
                Tools.Add(new ToolViewModel(tool.Name, tool.Description ?? "", inputs,
                    JsonSerializer.Serialize(tool.InputSchema, MockariumJson.IndentedOptions)));
            }
        OnPropertyChanged(nameof(VisibleTools));
        OnPropertyChanged(nameof(NoMatchingTools));
    }

    [RelayCommand]
    private void Open() => _shell.OpenStudio(Type);

    [RelayCommand]
    private void CreateStarter() => _shell.Run(() =>
    {
        if (_store.ListServers(WorkspaceId).Any(server => server.Type == Type))
            throw new InvalidOperationException($"This workspace already has a {Title}.");
        _store.AddServer(WorkspaceId, Type);
        RefreshServer();
        LoadData();
        _shell.Notice = $"{Title} starter data is ready.";
    });

    [RelayCommand]
    private async Task ToggleServerAsync() => await _shell.RunAsync(async () =>
    {
        BeforeToggleServer();
        var server = _store.ListServers(WorkspaceId).FirstOrDefault(candidate => candidate.Type == Type);
        if (server is null)
        {
            server = _store.AddServer(WorkspaceId, Type);
            RefreshServer();
            LoadData();
        }
        if (_runtime.GetServer(WorkspaceId, server.Id)?.Running == true)
            await _runtime.StopAsync(WorkspaceId, server.Id);
        else
            await _runtime.StartAsync(WorkspaceId, server.Id);
        RefreshServer();
        _shell.Notice = $"{Title} server {(IsRunning ? "started" : "stopped")}.";
    });

    [RelayCommand]
    private async Task RestoreAsync()
    {
        if (!HasWorkspace || !IsConfigured)
        {
            _shell.Error = "Create the starter data first.";
            return;
        }
        if (!await _platform.ConfirmAsync("Restore starter data",
            $"Replace the {Title} data with its starter fixtures? Saved execution history will be kept."))
            return;
        _shell.Run(() =>
        {
            ResetData();
            LoadData();
            _shell.Notice = $"{Title} starter data restored.";
        });
    }

    [RelayCommand]
    private void ToggleTools() => ShowTools = !ShowTools;

    [RelayCommand]
    private async Task CopyEndpointAsync() => await _shell.RunAsync(async () =>
    {
        if (!HasEndpoint) throw new InvalidOperationException("Start the server before copying its endpoint.");
        await _platform.CopyTextAsync(Endpoint);
        _shell.Notice = "Endpoint copied.";
    });

    [RelayCommand]
    private async Task CopyConfigurationAsync() => await _shell.RunAsync(async () =>
    {
        if (!HasEndpoint) throw new InvalidOperationException("Start the server before copying its configuration.");
        var configuration = new Dictionary<string, object>
        {
            ["mcpServers"] = new Dictionary<string, object>
            {
                [$"mockarium-{Type}"] = new { type = "http", url = Endpoint }
            }
        };
        await _platform.CopyTextAsync(JsonSerializer.Serialize(configuration, MockariumJson.IndentedOptions));
        _shell.Notice = "Client configuration copied.";
    });

    [RelayCommand]
    private async Task CopyToolSchemaAsync(ToolViewModel? tool) => await _shell.RunAsync(async () =>
    {
        if (tool is null) throw new InvalidOperationException("Choose a tool first.");
        await _platform.CopyTextAsync(tool.Schema);
        _shell.Notice = $"Schema for {tool.Name} copied.";
    });
}
