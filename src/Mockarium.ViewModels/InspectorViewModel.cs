using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mockarium.Core;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed partial class InspectorViewModel(
    DesktopViewModel shell, MockariumStore store, IPlatformServices platform) : ObservableObject
{
    private readonly Dictionary<string, HashSet<string>> _hidden = new(StringComparer.Ordinal);
    private readonly List<ExecutionEvent> _events = [];
    private string? _workspaceId;

    [ObservableProperty] private string search = "";
    [ObservableProperty] private string statusFilter = "All";
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PauseText))]
    private bool isPaused;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(InputJson))]
    [NotifyPropertyChangedFor(nameof(OutputJson))]
    private ExecutionEvent? selectedEvent;

    public ObservableCollection<ExecutionEvent> Events { get; } = [];
    public IReadOnlyList<string> StatusFilters { get; } = ["All", "Success", "Error"];
    public string PauseText => IsPaused ? "Resume capture" : "Pause capture";
    public string InputJson => SelectedEvent is null ? "" : Pretty(SelectedEvent.Input);
    public string OutputJson => SelectedEvent?.Output is { } output ? Pretty(output) : "";

    internal void LoadWorkspace(string? workspaceId)
    {
        _workspaceId = workspaceId;
        SelectedEvent = null;
        _events.Clear();
        if (workspaceId is not null) _events.AddRange(store.ListEvents(workspaceId, 1000));
        ApplyFilters();
    }

    internal void Capture(ExecutionEvent entry)
    {
        if (IsPaused || _workspaceId != entry.WorkspaceId) return;
        _events.Insert(0, entry);
        if (_events.Count > 1000) _events.RemoveAt(_events.Count - 1);
        ApplyFilters();
    }

    partial void OnSearchChanged(string value) => ApplyFilters();
    partial void OnStatusFilterChanged(string value) => ApplyFilters();

    [RelayCommand]
    private void TogglePause()
    {
        IsPaused = !IsPaused;
        if (!IsPaused) LoadWorkspace(_workspaceId);
    }

    [RelayCommand]
    private void ClearView()
    {
        if (_workspaceId is null) return;
        if (!_hidden.TryGetValue(_workspaceId, out var ids))
        {
            ids = new HashSet<string>(StringComparer.Ordinal);
            _hidden.Add(_workspaceId, ids);
        }
        foreach (var entry in _events) ids.Add(entry.Id);
        SelectedEvent = null;
        Search = "";
        StatusFilter = "All";
        ApplyFilters();
        shell.Notice = "Inspector view cleared. Saved history is still available in Export.";
    }

    [RelayCommand]
    private async Task ExportAsync() => await shell.RunAsync(async () =>
    {
        if (_workspaceId is null) throw new InvalidOperationException("Choose a workspace first.");
        var history = store.ListEvents(_workspaceId, 1000);
        if (await platform.SaveFileAsync("mockarium-execution-history.json", "json", "JSON",
            stream => JsonSerializer.SerializeAsync(stream, history, MockariumJson.IndentedOptions)))
            shell.Notice = "Execution history exported.";
    });

    [RelayCommand]
    private async Task ExportJsonLinesAsync() => await shell.RunAsync(async () =>
    {
        if (_workspaceId is null) throw new InvalidOperationException("Choose a workspace first.");
        var history = store.ListEvents(_workspaceId, 1000);
        if (await platform.SaveFileAsync("mockarium-execution-history.jsonl", "jsonl", "JSON Lines",
            stream => WriteJsonLinesAsync(stream, history)))
            shell.Notice = "Execution history exported as JSON Lines.";
    });

    private static async Task WriteJsonLinesAsync(Stream stream, IReadOnlyList<ExecutionEvent> history)
    {
        await JsonSerializer.SerializeAsyncEnumerable(stream, AsAsyncEnumerable(history),
            topLevelValues: true, options: MockariumJson.Options);
    }

    private static async IAsyncEnumerable<ExecutionEvent> AsAsyncEnumerable(IReadOnlyList<ExecutionEvent> history)
    {
        foreach (var entry in history) yield return entry;
        await Task.CompletedTask;
    }

    private void ApplyFilters()
    {
        var selectedId = SelectedEvent?.Id;
        Events.Clear();
        if (_workspaceId is null) return;
        _hidden.TryGetValue(_workspaceId, out var hidden);
        foreach (var entry in _events)
        {
            if (hidden?.Contains(entry.Id) == true) continue;
            if (StatusFilter == "Success" && !entry.Success || StatusFilter == "Error" && entry.Success) continue;
            if (!string.IsNullOrWhiteSpace(Search) &&
                !$"{entry.ToolName} {entry.ServerName} {entry.Input.GetRawText()}".Contains(Search, StringComparison.OrdinalIgnoreCase))
                continue;
            Events.Add(entry);
        }
        if (selectedId is not null) SelectedEvent = Events.FirstOrDefault(entry => entry.Id == selectedId);
    }

    private static string Pretty(JsonElement value) => JsonSerializer.Serialize(value, MockariumJson.IndentedOptions);
}
