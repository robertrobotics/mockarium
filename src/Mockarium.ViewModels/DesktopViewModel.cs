using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed record WorkspaceChoice(Workspace Workspace, bool IsCurrent);

public sealed partial class DesktopViewModel : ObservableObject, IAsyncDisposable
{
    private readonly MockariumStore _store;
    private readonly McpRuntime _runtime;
    private readonly IPlatformServices _platform;
    private readonly ILogger _logger;
    private bool _changingWorkspaces;
    private bool _workspaceChangePending;
    private bool _disposed;

    [ObservableProperty]
    private Workspace? selectedWorkspace;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CreateWorkspaceCommand))]
    private string workspaceName = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CloseWorkspacePickerCommand))]
    private bool workspacePickerOpen;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(WorkspaceMatches))]
    [NotifyPropertyChangedFor(nameof(NoWorkspaceMatches))]
    private string workspaceQuery = "";

    public IReadOnlyList<WorkspaceChoice> WorkspaceMatches => Workspaces.Where(item =>
        item.Name.Contains(WorkspaceQuery.Trim(), StringComparison.OrdinalIgnoreCase))
        .Select(item => new WorkspaceChoice(item, item.Id == SelectedWorkspace?.Id)).ToArray();
    public bool NoWorkspaceMatches => WorkspaceMatches.Count == 0;

    partial void OnWorkspacePickerOpenChanged(bool value)
    {
        WorkspaceQuery = "";
        if (value)
        {
            WorkspaceName = SelectedWorkspace?.Name ?? "";
            NotifyWorkspaceListChanged();
        }
    }

    [RelayCommand]
    private void ToggleWorkspacePicker() => WorkspacePickerOpen = !WorkspacePickerOpen;

    [RelayCommand(CanExecute = nameof(WorkspacePickerOpen))]
    private void CloseWorkspacePicker() => WorkspacePickerOpen = false;

    [RelayCommand]
    private void ChooseWorkspace(Workspace workspace)
    {
        if (SelectedWorkspace?.Id == workspace.Id) WorkspacePickerOpen = false;
        else SelectedWorkspace = workspace;
    }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string error = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    private string notice = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOverview))]
    [NotifyPropertyChangedFor(nameof(IsEmail))]
    [NotifyPropertyChangedFor(nameof(IsDatabase))]
    [NotifyPropertyChangedFor(nameof(IsCalendar))]
    [NotifyPropertyChangedFor(nameof(IsInspector))]
    private object currentPage;

    [ObservableProperty]
    private bool reduceMotion;

    [ObservableProperty]
    private bool isNightMode;

    [ObservableProperty]
    private string currentPageTitle = "Overview";

    public DesktopViewModel(MockariumStore store, McpRuntime runtime, IPlatformServices platform, ILoggerFactory loggerFactory)
    {
        _store = store;
        _runtime = runtime;
        _platform = platform;
        _logger = loggerFactory.CreateLogger<DesktopViewModel>();
        Email = new EmailStudioViewModel(this, store, runtime, platform);
        Database = new DatabaseStudioViewModel(this, store, runtime, platform);
        Calendar = new CalendarStudioViewModel(this, store, runtime, platform);
        Inspector = new InspectorViewModel(this, store, platform);
        Overview = new OverviewViewModel(this, [Email, Database, Calendar]);
        reduceMotion = _store.GetReduceMotion();
        isNightMode = _store.GetNightMode();
        currentPage = Overview;
        _runtime.ExecutionCaptured += OnExecutionCaptured;
        RefreshWorkspaces(_store.GetActiveWorkspaceId());
    }

    public ObservableCollection<Workspace> Workspaces { get; } = [];
    public OverviewViewModel Overview { get; }
    public EmailStudioViewModel Email { get; }
    public DatabaseStudioViewModel Database { get; }
    public CalendarStudioViewModel Calendar { get; }
    public InspectorViewModel Inspector { get; }
    public bool HasError => !string.IsNullOrEmpty(Error);
    public bool HasNotice => !string.IsNullOrEmpty(Notice);
    public bool HasWorkspace => SelectedWorkspace is not null;
    public bool HasUnsavedChanges => Email.HasUnsavedChanges || Database.HasUnsavedChanges || Calendar.HasUnsavedChanges;
    public bool IsOverview => CurrentPage == Overview;
    public bool IsEmail => CurrentPage == Email;
    public bool IsDatabase => CurrentPage == Database;
    public bool IsCalendar => CurrentPage == Calendar;
    public bool IsInspector => CurrentPage == Inspector;

    partial void OnReduceMotionChanged(bool value) => Run(() => _store.SetReduceMotion(value));

    partial void OnIsNightModeChanged(bool value)
    {
        try { _store.SetNightMode(value); }
        catch (Exception exception) { Report(exception); }
    }

    partial void OnSelectedWorkspaceChanged(Workspace? oldValue, Workspace? newValue)
    {
        OnPropertyChanged(nameof(HasWorkspace));
        if (_changingWorkspaces) return;
        if (oldValue?.Id != newValue?.Id && oldValue is not null && (HasUnsavedChanges || _workspaceChangePending))
        {
            _changingWorkspaces = true;
            try { SelectedWorkspace = oldValue; }
            finally { _changingWorkspaces = false; }
            if (!_workspaceChangePending) _ = ConfirmWorkspaceChangeAsync(oldValue, newValue);
            return;
        }
        Run(() =>
        {
            if (newValue is not null) _store.SelectWorkspace(newValue.Id);
            ActivateWorkspace(newValue);
        });
    }

    private async Task ConfirmWorkspaceChangeAsync(Workspace previous, Workspace? next)
    {
        _workspaceChangePending = true;
        try
        {
            await RunAsync(async () =>
            {
                if (!await ConfirmDiscardChangesAsync("Switch workspace")) return;
                if (SelectedWorkspace?.Id != previous.Id) return;
                if (next is not null) _store.SelectWorkspace(next.Id);
                _changingWorkspaces = true;
                try { SelectedWorkspace = next; }
                finally { _changingWorkspaces = false; }
                ActivateWorkspace(next);
            });
        }
        finally
        {
            _workspaceChangePending = false;
        }
    }

    public Task<bool> ConfirmCloseAsync() => ConfirmDiscardChangesAsync("Close Mockarium");

    private Task<bool> ConfirmDiscardChangesAsync(string title) =>
        !HasUnsavedChanges ? Task.FromResult(true) : _platform.ConfirmAsync(
            title, "Discard unsaved changes in the current workspace? This cannot be undone.");

    private void ActivateWorkspace(Workspace? workspace)
    {
        WorkspacePickerOpen = false;
        WorkspaceName = workspace?.Name ?? "";
        Email.LoadWorkspace(workspace?.Id);
        Database.LoadWorkspace(workspace?.Id);
        Calendar.LoadWorkspace(workspace?.Id);
        Inspector.LoadWorkspace(workspace?.Id);
        if (workspace is null) Navigate("overview");
    }

    private void RefreshWorkspaces(string? selectedId)
    {
        _changingWorkspaces = true;
        try
        {
            var workspaces = _store.ListWorkspaces();
            Workspaces.Clear();
            foreach (var workspace in workspaces) Workspaces.Add(workspace);
            SelectedWorkspace = workspaces.FirstOrDefault(workspace => workspace.Id == selectedId)
                ?? workspaces.FirstOrDefault();
        }
        finally
        {
            _changingWorkspaces = false;
        }
        ActivateWorkspace(SelectedWorkspace);
        NotifyWorkspaceListChanged();
    }

    private void NotifyWorkspaceListChanged()
    {
        OnPropertyChanged(nameof(WorkspaceMatches));
        OnPropertyChanged(nameof(NoWorkspaceMatches));
    }

    [RelayCommand]
    private void Navigate(string? page)
    {
        (object Page, string Title) destination = page switch
        {
            "email" => (Email, "Email Studio"),
            "database" => (Database, "Database Studio"),
            "calendar" => (Calendar, "Calendar Studio"),
            "inspector" => (Inspector, "Live Inspector"),
            _ => (Overview, "Overview")
        };
        CurrentPage = destination.Page;
        CurrentPageTitle = destination.Title;
        Error = "";
    }

    internal void OpenStudio(string type) => Navigate(type);

    private bool CanCreateWorkspace() => !string.IsNullOrWhiteSpace(WorkspaceName);

    [RelayCommand(CanExecute = nameof(CanCreateWorkspace))]
    private async Task CreateWorkspaceAsync() => await RunAsync(async () =>
    {
        if (!await ConfirmDiscardChangesAsync("Create workspace")) return;
        var workspace = _store.CreateWorkspace(WorkspaceName);
        RefreshWorkspaces(workspace.Id);
        Notice = $"Workspace \"{workspace.Name}\" created.";
    });

    [RelayCommand]
    private void RenameWorkspace() => Run(() =>
    {
        var workspace = SelectedWorkspace ?? throw new InvalidOperationException("Choose a workspace first.");
        var renamed = _store.RenameWorkspace(workspace.Id, WorkspaceName);
        _changingWorkspaces = true;
        try
        {
            var index = Workspaces.IndexOf(workspace);
            if (index >= 0) Workspaces[index] = renamed;
            SelectedWorkspace = renamed;
        }
        finally { _changingWorkspaces = false; }
        WorkspaceName = renamed.Name;
        NotifyWorkspaceListChanged();
        Notice = "Workspace renamed.";
    });

    [RelayCommand]
    private async Task DeleteWorkspaceAsync()
    {
        var workspace = SelectedWorkspace;
        if (workspace is null) { Error = "Choose a workspace first."; return; }
        if (!await _platform.ConfirmAsync("Delete workspace",
            $"Delete \"{workspace.Name}\" and all of its mock data and saved execution history? This cannot be undone."))
            return;
        await RunAsync(async () =>
        {
            await _runtime.StopWorkspaceAsync(workspace.Id);
            _store.DeleteWorkspace(workspace.Id);
            RefreshWorkspaces(_store.GetActiveWorkspaceId());
            Notice = "Workspace deleted.";
        });
    }

    [RelayCommand]
    private void DismissError() => Error = "";

    [RelayCommand]
    private void DismissNotice() => Notice = "";

    internal bool Run(Action action)
    {
        try
        {
            Error = "";
            Notice = "";
            action();
            return true;
        }
        catch (Exception exception)
        {
            Report(exception);
            return false;
        }
    }

    internal async Task<bool> RunAsync(Func<Task> action)
    {
        try
        {
            Error = "";
            Notice = "";
            await action();
            return true;
        }
        catch (Exception exception)
        {
            Report(exception);
            return false;
        }
    }

    private void Report(Exception exception)
    {
        _logger.LogError(exception, "Mockarium operation failed");
        Error = exception is ArgumentException or InvalidOperationException
            ? exception.Message
            : $"The operation failed: {exception.Message}";
    }

    private void OnExecutionCaptured(object? sender, ExecutionEvent entry)
    {
        _platform.Post(() =>
        {
            if (_disposed || SelectedWorkspace?.Id != entry.WorkspaceId) return;
            try
            {
                Inspector.Capture(entry);
                if (!entry.Success) return;
                Email.OnAgentExecution(entry);
                Database.OnAgentExecution(entry);
                Calendar.OnAgentExecution(entry);
            }
            catch (Exception exception)
            {
                Report(exception);
            }
        });
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _runtime.DisposeAsync();
        _disposed = true;
        _runtime.ExecutionCaptured -= OnExecutionCaptured;
        _store.Dispose();
    }
}

public sealed class OverviewViewModel : ObservableObject
{
    public DesktopViewModel Shell { get; }
    public IReadOnlyList<StudioViewModel> Studios { get; }
    public int RunningCount => Studios.Count(studio => studio.IsRunning);

    public OverviewViewModel(DesktopViewModel shell, IReadOnlyList<StudioViewModel> studios)
    {
        Shell = shell;
        Studios = studios;
        foreach (var studio in Studios)
            studio.PropertyChanged += (_, change) =>
            {
                if (change.PropertyName == nameof(StudioViewModel.IsRunning))
                    OnPropertyChanged(nameof(RunningCount));
            };
    }
}
