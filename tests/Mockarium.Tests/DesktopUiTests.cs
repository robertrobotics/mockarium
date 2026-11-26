using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Input.Raw;
using Avalonia.Media.Imaging;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.Logging.Abstractions;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;
using Mockarium.Desktop;
using Mockarium.Desktop.Views;
using Mockarium.ViewModels;

namespace Mockarium.Tests;

public static class HeadlessAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions
        {
            UseHeadlessDrawing = false
        }).WithInterFont();
}

public sealed class DesktopUiTests
{
    [Fact]
    public async Task SearchableWorkspacePickerKeepsTheCurrentDraftUntilSwitchIsConfirmed()
    {
        using var session = HeadlessUnitTestSession.StartNew(typeof(HeadlessAppBuilder));
        await session.Dispatch(async () =>
        {
            var store = new MockariumStore(":memory:");
            var platform = new TestPlatform { ConfirmResult = false };
            await using var shell = new DesktopViewModel(store, new McpRuntime(store, NullLoggerFactory.Instance), platform, NullLoggerFactory.Instance);
            shell.WorkspaceName = "Research";
            await shell.CreateWorkspaceCommand.ExecuteAsync(null);
            shell.WorkspaceName = "Design lab";
            await shell.CreateWorkspaceCommand.ExecuteAsync(null);
            shell.Email.CreateStarterCommand.Execute(null);
            shell.Email.Subject = "Keep my draft";
            var window = new MainWindow { Width = 1050, Height = 700 };
            window.Initialize(shell);
            window.Show();
            var switcher = window.FindControl<Button>("WorkspaceSwitcher")!;
            var search = window.FindControl<TextBox>("WorkspaceFilter")!;
            Click(window, switcher);
            Dispatcher.UIThread.RunJobs();
            Assert.True(search.IsFocused);
            window.KeyTextInput("res");
            Dispatcher.UIThread.RunJobs();
            var choice = Assert.Single(window.GetVisualDescendants().OfType<Button>(),
                button => button.Command == shell.ChooseWorkspaceCommand);
            Assert.Equal("Research", ControlAutomationPeer.CreatePeerForElement(choice)!.GetName());
            Click(window, choice);
            Assert.Equal(1, platform.ConfirmationCount);
            Assert.Equal("Design lab", shell.SelectedWorkspace?.Name);
            Assert.Equal("Keep my draft", shell.Email.Subject);
            Assert.True(shell.WorkspacePickerOpen);
            window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
            window.KeyRelease(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
            Dispatcher.UIThread.RunJobs();
            Assert.False(shell.WorkspacePickerOpen);
            Assert.True(switcher.IsFocused);

            Click(window, switcher);
            Dispatcher.UIThread.RunJobs();
            Assert.Equal("", search.Text);
            SaveFrame(window, "workspace-picker");
            var research = window.GetVisualDescendants().OfType<Button>().Single(button =>
                button.Command == shell.ChooseWorkspaceCommand && ControlAutomationPeer.CreatePeerForElement(button)!.GetName() == "Research");
            platform.ConfirmResult = true;
            Click(window, research);
            Assert.Equal("Research", shell.SelectedWorkspace?.Name);
            Assert.False(shell.WorkspacePickerOpen);
            window.Close();
            return true;
        }, CancellationToken.None);
    }

    [Fact]
    public async Task DatabaseTableRemovalButtonPreservesRecordDraftWhenConfirmationIsDeclined()
    {
        using var session = HeadlessUnitTestSession.StartNew(typeof(HeadlessAppBuilder));
        await session.Dispatch(async () =>
        {
            var store = new MockariumStore(":memory:");
            var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
            var platform = new TestPlatform();
            var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
            shell.WorkspaceName = "Table drafts";
            shell.CreateWorkspaceCommand.Execute(null);
            shell.Database.CreateStarterCommand.Execute(null);
            var database = shell.Database;
            var table = database.Tables.Single(item => item.Name == "companies");
            database.SelectedTable = table;
            database.SelectedRecord = database.Records.Single(item => item.Id == "company_northstar");
            var name = database.RecordFields.Single(item => item.Name == "name");
            name.Value = "Unsaved company";

            var window = new MainWindow();
            window.Initialize(shell);
            window.Show();
            var navigationButton = window.GetVisualDescendants().OfType<Button>()
                .Single(button => button.Content?.ToString()?.Contains("Database Studio", StringComparison.Ordinal) == true);
            Click(window, navigationButton);
            Dispatcher.UIThread.RunJobs();
            var view = window.GetVisualDescendants().OfType<DatabaseStudioView>().Single();
            shell.DismissNoticeCommand.Execute(null);
            SaveFrame(window, "database");
            var appearance = window.FindControl<ToggleButton>("AppearanceSwitch")!;
            Click(window, appearance);
            SaveFrame(window, "database-night");
            window.Width = window.MinWidth;
            window.Height = window.MinHeight;
            Dispatcher.UIThread.RunJobs();
            var recordInput = view.GetVisualDescendants().OfType<TextBox>()
                .Single(input => ReferenceEquals(input.DataContext, name));
            Assert.Equal(name.Label, ControlAutomationPeer.CreatePeerForElement(recordInput)!.GetName());
            var modelTab = view.GetVisualDescendants().OfType<TabItem>()
                .Single(item => item.Header?.ToString() == "Model designer");
            Click(window, modelTab);
            Dispatcher.UIThread.RunJobs();
            var removeTable = view.GetVisualDescendants().OfType<Button>()
                .Single(button => button.Command == database.RemoveTableCommand);
            removeTable.BringIntoView();
            await WaitForHitTargetAsync(window, removeTable);
            Assert.Equal("Remove table", ControlAutomationPeer.CreatePeerForElement(removeTable)!.GetName());

            platform.ConfirmResult = false;
            Click(window, removeTable);
            Dispatcher.UIThread.RunJobs();
            Assert.Equal(1, platform.ConfirmationCount);
            Assert.Contains(table, database.Tables);
            Assert.Same(table, database.SelectedTable);
            Assert.Equal("Unsaved company", name.Value);

            platform.ConfirmResult = true;
            Click(window, removeTable);
            Dispatcher.UIThread.RunJobs();
            Assert.True(platform.ConfirmationCount == 2,
                string.Join(Environment.NewLine, platform.Confirmations.Select(item => $"{item.Title}: {item.Message}")));
            Assert.DoesNotContain(table, database.Tables);
            Assert.Empty(shell.Error);

            await shell.DisposeAsync();
            window.Close();
            return true;
        }, CancellationToken.None);
    }

    [Fact]
    public async Task WorkspaceAndEmailStudioAreUsableThroughTheActualViews()
    {
        using var session = HeadlessUnitTestSession.StartNew(typeof(HeadlessAppBuilder));
        await session.Dispatch(async () =>
        {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        var window = new MainWindow();
        window.Initialize(shell);
        window.Show();

        var overview = window.GetVisualDescendants().OfType<OverviewView>().Single();
        var input = overview.FindControl<TextBox>("FirstWorkspaceName")!;
        var createWorkspace = overview.FindControl<Button>("FirstWorkspaceCreate")!;
        Assert.False(createWorkspace.IsEffectivelyEnabled);
        Assert.False(window.FindControl<Button>("EmailNavigationButton")!.IsEnabled);
        SaveFrame(window, "first-run");
        input.Focus();
        window.KeyTextInput("Design lab");
        Assert.True(createWorkspace.IsEffectivelyEnabled);
        window.KeyPress(Key.Enter, RawInputModifiers.None, PhysicalKey.Enter, "\r");
        window.KeyRelease(Key.Enter, RawInputModifiers.None, PhysicalKey.Enter, "\r");
        Assert.Equal("Design lab", shell.SelectedWorkspace?.Name);
        Assert.False(createWorkspace.IsEffectivelyVisible);
        shell.DismissNoticeCommand.Execute(null);
        SaveFrame(window, "overview");
        var appearance = window.FindControl<ToggleButton>("AppearanceSwitch")!;
        var dayBackground = ((ISolidColorBrush)window.Background!).Color;
        appearance.Focus();
        window.KeyPress(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " ");
        window.KeyRelease(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " ");
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(ThemeVariant.Dark, window.ActualThemeVariant);
        Assert.NotEqual(dayBackground, ((ISolidColorBrush)window.Background!).Color);
        Assert.True(appearance.IsChecked);
        SaveFrame(window, "overview-night");

        Click(window, window.FindControl<Button>("EmailNavigationButton")!);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains(window.GetVisualDescendants(), control => control is EmailStudioView);
        var emailView = window.GetVisualDescendants().OfType<EmailStudioView>().Single();
        var editorTabs = emailView.GetVisualDescendants().OfType<TabControl>().Single();
        Assert.False(editorTabs.IsEffectivelyVisible);
        var setup = emailView.GetVisualDescendants().OfType<Button>().Single(button => button.Command == shell.Email.CreateStarterCommand);
        SaveFrame(window, "email-setup");
        Click(window, setup);
        Dispatcher.UIThread.RunJobs();
        Assert.True(editorTabs.IsEffectivelyVisible);
        Assert.NotNull(editorTabs.PageTransition);
        Assert.False(shell.Email.IsRunning);
        var start = window.GetVisualDescendants().OfType<Button>()
            .Single(button => button.Content?.ToString() == "Start server");
        Click(window, start);
        for (var attempt = 0; attempt < 100 && !shell.Email.IsRunning; attempt++)
            await Task.Delay(20);
        Assert.True(shell.Email.IsRunning, shell.Error);
        Assert.Equal(3, shell.Email.Messages.Count);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("Inbox", shell.Email.EditFolder);
        var folderSelector = emailView.FindControl<ComboBox>("MessageFolderSelector")!;
        Assert.Equal("Inbox", folderSelector.SelectedItem);
        Assert.Equal("Message folder", ControlAutomationPeer.CreatePeerForElement(folderSelector)!.GetName());
        var subjectInput = emailView.FindControl<TextBox>("MessageSubjectInput")!;
        Assert.Equal("Message subject", ControlAutomationPeer.CreatePeerForElement(subjectInput)!.GetName());
        Assert.Equal(1, shell.Overview.RunningCount);
        var nightEditor = ((ISolidColorBrush)subjectInput.Background!).Color;
        shell.Email.Subject = "Local draft";
        var endpoint = shell.Email.Endpoint;
        var connection = emailView.GetVisualDescendants().OfType<ToggleButton>()
            .Single(button => Equals(button.Content, "Connection and tools"));
        Click(window, connection);
        Dispatcher.UIThread.RunJobs();
        var copy = emailView.GetVisualDescendants().OfType<Button>().Single(button => button.Command == shell.Email.CopyConfigurationCommand);
        Assert.True(copy.IsEffectivelyVisible);
        Click(window, copy);
        Assert.Equal("Client configuration copied.", shell.Notice);
        Click(window, connection);
        Dispatcher.UIThread.RunJobs();
        Assert.False(copy.IsEffectivelyVisible);
        Click(window, appearance);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(ThemeVariant.Light, window.ActualThemeVariant);
        Assert.NotEqual(nightEditor, ((ISolidColorBrush)subjectInput.Background!).Color);
        Assert.Equal("Local draft", subjectInput.Text);
        Assert.Equal(endpoint, shell.Email.Endpoint);
        shell.DismissNoticeCommand.Execute(null);
        SaveFrame(window, "email");
        Click(window, appearance);
        Dispatcher.UIThread.RunJobs();
        SaveFrame(window, "email-night");

        var motion = window.GetVisualDescendants().OfType<CheckBox>()
            .Single(box => Equals(box.Content, "Reduce motion"));
        Click(window, motion);
        Assert.True(shell.ReduceMotion);
        Assert.Null(window.FindControl<Button>("EmailNavigationButton")!.Transitions);
        Assert.Null(editorTabs.PageTransition);
        window.Width = window.MinWidth;
        window.Height = window.MinHeight;
        Dispatcher.UIThread.RunJobs();
        var emailScroll = emailView.GetVisualAncestors().OfType<ScrollViewer>().First();
        emailScroll.ScrollToEnd();
        Dispatcher.UIThread.RunJobs();
        Assert.True(emailScroll.Offset.Y > 0);

        Click(window, window.FindControl<Button>("CalendarNavigationButton")!);
        Dispatcher.UIThread.RunJobs();
        var calendarView = window.GetVisualDescendants().OfType<CalendarStudioView>().Single();
        Assert.Equal(0, calendarView.GetVisualAncestors().OfType<ScrollViewer>().First().Offset.Y);
        var create = window.GetVisualDescendants().OfType<Button>()
            .Single(button => button.Content?.ToString() == "Create starter data" && button.IsVisible);
        Click(window, create);
        Dispatcher.UIThread.RunJobs();
        Assert.True(shell.Calendar.IsConfigured, shell.Error);
        shell.DismissNoticeCommand.Execute(null);
        SaveFrame(window, "calendar-night");
        Click(window, appearance);
        SaveFrame(window, "calendar");
        var planner = calendarView.FindControl<WeekPlannerControl>("WeekPlanner")!;
        var block = shell.Calendar.WeekBlocks.Single(item => item.Event.Id == "event-vendor-review");
        var dayWidth = (planner.Bounds.Width - 52) / 7;
        var position = new Point(52 + block.DayIndex * dayWidth + 12,
            block.StartMinute / 60 * WeekPlannerControl.HourHeight + 8);
        var startPoint = planner.TranslatePoint(position, window)!.Value;
        var endPoint = startPoint + new Vector(0, WeekPlannerControl.HourHeight / 2);
        Assert.InRange(startPoint.Y, 0, window.Bounds.Height);
        window.MouseDown(startPoint, MouseButton.Left, RawInputModifiers.None);
        window.MouseMove(endPoint, RawInputModifiers.LeftMouseButton);
        window.MouseUp(endPoint, MouseButton.Left, RawInputModifiers.None);
        Assert.Equal("2025-03-11T10:00:00.000Z",
            store.GetCalendarEvent(shell.SelectedWorkspace!.Id, block.Event.Id)!.StartAt);
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        block = shell.Calendar.WeekBlocks.Single(item => item.Event.Id == "event-vendor-review");
        position = new Point(52 + block.DayIndex * dayWidth + 12,
            block.EndMinute / 60 * WeekPlannerControl.HourHeight - 6);
        startPoint = planner.TranslatePoint(position, window)!.Value;
        endPoint = startPoint + new Vector(0, WeekPlannerControl.HourHeight / 4);
        window.MouseDown(startPoint, MouseButton.Left, RawInputModifiers.None);
        window.MouseMove(endPoint, RawInputModifiers.LeftMouseButton);
        window.MouseUp(endPoint, MouseButton.Left, RawInputModifiers.None);
        Assert.Equal("2025-03-11T11:15:00.000Z",
            store.GetCalendarEvent(shell.SelectedWorkspace.Id, block.Event.Id)!.EndAt);

        position = new Point(52 + 12, 11 * WeekPlannerControl.HourHeight);
        startPoint = planner.TranslatePoint(position, window)!.Value;
        window.MouseDown(startPoint, MouseButton.Left, RawInputModifiers.None);
        window.MouseUp(startPoint, MouseButton.Left, RawInputModifiers.None);
        Assert.Equal(1, shell.Calendar.SelectedCalendarTabIndex);
        Assert.Equal("2025-03-10T11:00:00.000Z", shell.Calendar.EventStart);

        await shell.DisposeAsync();
        window.Close();
        return true;
        }, CancellationToken.None);
    }

    private static void Click(Window window, Control control)
    {
        var point = control.TranslatePoint(new Point(control.Bounds.Width / 2, control.Bounds.Height / 2), window)
            ?? throw new InvalidOperationException("The control is not in the window.");
        window.MouseDown(point, MouseButton.Left, RawInputModifiers.None);
        window.MouseUp(point, MouseButton.Left, RawInputModifiers.None);
    }

    private static async Task WaitForHitTargetAsync(Window window, Control control)
    {
        Visual? hit = null;
        Point? center = null;
        for (var attempt = 0; attempt < 60; attempt++)
        {
            Dispatcher.UIThread.RunJobs();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            center = control.TranslatePoint(new Point(control.Bounds.Width / 2, control.Bounds.Height / 2), window);
            hit = center is { } point ? window.InputHitTest(point) as Visual : null;
            if (hit == control || hit?.GetVisualAncestors().Contains(control) == true) return;
            await Task.Delay(16);
        }
        Assert.Fail($"Expected {control} at {center}, but hit {hit}. Control bounds: {control.Bounds}.");
    }

    private static void SaveFrame(Window window, string name)
    {
        using var bitmap = window.CaptureRenderedFrame();
        Assert.NotNull(bitmap);
        Assert.True(bitmap.PixelSize.Width >= 1000);
        var directory = Environment.GetEnvironmentVariable("MOCKARIUM_SCREENSHOT_DIR");
        if (!string.IsNullOrEmpty(directory))
            bitmap.Save(Path.Combine(directory, $"{name}.png"), PngBitmapEncoderOptions.Default);
    }

    private sealed class TestPlatform : IPlatformServices
    {
        public bool ConfirmResult { get; set; } = true;
        public List<(string Title, string Message)> Confirmations { get; } = [];
        public int ConfirmationCount => Confirmations.Count;
        public void Post(Action action) => Dispatcher.UIThread.Post(action);
        public Task<bool> ConfirmAsync(string title, string message)
        {
            Confirmations.Add((title, message));
            return Task.FromResult(ConfirmResult);
        }
        public Task CopyTextAsync(string text) => Task.CompletedTask;
        public Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync) => Task.FromResult(true);
    }
}
