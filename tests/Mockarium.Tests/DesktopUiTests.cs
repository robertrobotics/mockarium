using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
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
            var recordInput = view.GetVisualDescendants().OfType<TextBox>()
                .Single(input => ReferenceEquals(input.DataContext, name));
            Assert.Equal(name.Label, ControlAutomationPeer.CreatePeerForElement(recordInput)!.GetName());
            var modelTab = view.GetVisualDescendants().OfType<TabItem>()
                .Single(item => item.Header?.ToString() == "Model designer");
            Click(window, modelTab);
            Dispatcher.UIThread.RunJobs();
            var removeTable = view.GetVisualDescendants().OfType<Button>()
                .Single(button => button.Command == database.RemoveTableCommand);
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
        var night = window.FindControl<RadioButton>("NightModeButton")!;
        var day = window.FindControl<RadioButton>("DayModeButton")!;
        var dayBackground = ((ISolidColorBrush)window.Background!).Color;
        Click(window, night);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(ThemeVariant.Dark, window.ActualThemeVariant);
        Assert.NotEqual(dayBackground, ((ISolidColorBrush)window.Background!).Color);
        Assert.True(night.IsChecked);
        SaveFrame(window, "overview-night");

        Click(window, window.FindControl<Button>("EmailNavigationButton")!);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains(window.GetVisualDescendants(), control => control is EmailStudioView);
        var start = window.GetVisualDescendants().OfType<Button>()
            .Single(button => button.Content?.ToString() == "Start server");
        Click(window, start);
        for (var attempt = 0; attempt < 100 && !shell.Email.IsRunning; attempt++)
            await Task.Delay(20);
        Assert.True(shell.Email.IsRunning, shell.Error);
        Assert.Equal(3, shell.Email.Messages.Count);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("Inbox", shell.Email.EditFolder);
        var emailView = window.GetVisualDescendants().OfType<EmailStudioView>().Single();
        var folderSelector = emailView.FindControl<ComboBox>("MessageFolderSelector")!;
        Assert.Equal("Inbox", folderSelector.SelectedItem);
        Assert.Equal("Message folder", ControlAutomationPeer.CreatePeerForElement(folderSelector)!.GetName());
        var subjectInput = emailView.FindControl<TextBox>("MessageSubjectInput")!;
        Assert.Equal("Message subject", ControlAutomationPeer.CreatePeerForElement(subjectInput)!.GetName());
        Assert.Equal(1, shell.Overview.RunningCount);
        var nightEditor = ((ISolidColorBrush)subjectInput.Background!).Color;
        shell.Email.Subject = "Local draft";
        var endpoint = shell.Email.Endpoint;
        Click(window, day);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(ThemeVariant.Light, window.ActualThemeVariant);
        Assert.NotEqual(nightEditor, ((ISolidColorBrush)subjectInput.Background!).Color);
        Assert.Equal("Local draft", subjectInput.Text);
        Assert.Equal(endpoint, shell.Email.Endpoint);
        SaveFrame(window, "email");
        Click(window, night);
        Dispatcher.UIThread.RunJobs();
        SaveFrame(window, "email-night");

        var motion = window.GetVisualDescendants().OfType<CheckBox>()
            .Single(box => Equals(box.Content, "Reduce motion"));
        Click(window, motion);
        Assert.True(shell.ReduceMotion);
        Assert.Null(window.FindControl<Button>("EmailNavigationButton")!.Transitions);
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
