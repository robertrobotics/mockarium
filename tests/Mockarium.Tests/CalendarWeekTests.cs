using Microsoft.Extensions.Logging.Abstractions;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;
using Mockarium.ViewModels;

namespace Mockarium.Tests;

public sealed class CalendarWeekTests
{
    [Fact]
    public async Task WeekPlannerShowsOverlapsAndReschedulesWithoutLosingDuration()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "Planner";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Calendar.CreateStarterCommand.Execute(null);
        var id = shell.SelectedWorkspace!.Id;
        var original = store.GetCalendarEvent(id, "event-product-sync")!;
        var overlapping = store.SaveCalendarEvent(id, null, original.ToInput() with { Title = "Overlapping event" });
        shell.Calendar.RefreshCommand.Execute(null);

        var blocks = shell.Calendar.WeekBlocks.Where(block => block.Event.Id == original.Id || block.Event.Id == overlapping.Id).ToArray();
        Assert.Equal(2, blocks.Length);
        Assert.All(blocks, block => { Assert.True(block.HasConflict); Assert.Equal(2, block.LaneCount); });
        Assert.Equal(2, blocks.Select(block => block.Lane).Distinct().Count());

        shell.Calendar.MoveWeekEvent(original, 1, 30, resize: false);
        var moved = store.GetCalendarEvent(id, original.Id)!;
        Assert.Equal("2025-03-11T16:30:00.000Z", moved.StartAt);
        Assert.Equal("2025-03-11T17:00:00.000Z", moved.EndAt);
        shell.Calendar.MoveWeekEvent(moved, 0, 30, resize: true);
        Assert.Equal("2025-03-11T17:30:00.000Z", store.GetCalendarEvent(id, original.Id)!.EndAt);
        Assert.Contains(shell.Calendar.WeekBlocks, block => block.Event.Id == original.Id && block.DayIndex == 1);
    }

    [Fact]
    public async Task MovingAcrossDaylightSavingPreservesLocalTimeAndRejectsMissingTimes()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "DST";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Calendar.CreateStarterCommand.Execute(null);
        var id = shell.SelectedWorkspace!.Id;
        var profile = store.GetCalendarProfile(id);
        store.SaveCalendarProfile(id, profile with { TimeZone = "America/New_York", CurrentTime = "2025-03-08T12:00:00Z" });
        var source = store.SaveCalendarEvent(id, null, new CalendarEventInput(
            "Morning", "", "", "2025-03-08T15:00:00Z", "2025-03-08T16:00:00Z", profile.Email, [], "confirmed"));
        var missing = store.SaveCalendarEvent(id, null, source.ToInput() with
        {
            Title = "Missing local time", StartAt = "2025-03-08T07:30:00Z", EndAt = "2025-03-08T08:30:00Z"
        });
        shell.Calendar.RefreshCommand.Execute(null);

        shell.Calendar.MoveWeekEvent(source, 1, 0, resize: false);
        var moved = store.GetCalendarEvent(id, source.Id)!;
        Assert.Equal("2025-03-09T14:00:00.000Z", moved.StartAt);
        Assert.Equal("2025-03-09T15:00:00.000Z", moved.EndAt);
        shell.Calendar.MoveWeekEvent(missing, 1, 0, resize: false);
        Assert.Contains("does not exist", shell.Error);
        Assert.Equal(missing.StartAt, store.GetCalendarEvent(id, missing.Id)!.StartAt);
    }

    [Fact]
    public async Task CreatingAnEventInTheRepeatedHourUsesTheEarlierOffsetAndRejectsTheSpringGap()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "DST boundaries";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Calendar.CreateStarterCommand.Execute(null);
        var id = shell.SelectedWorkspace!.Id;
        var profile = store.GetCalendarProfile(id);
        store.SaveCalendarProfile(id, profile with
        {
            TimeZone = "America/New_York",
            CurrentTime = "2025-11-02T12:00:00Z"
        });
        await shell.Calendar.RefreshCommand.ExecuteAsync(null);

        await shell.Calendar.CreateWeekEventAsync(6, 90);
        Assert.Empty(shell.Error);
        Assert.Equal("2025-11-02T05:30:00.000Z", shell.Calendar.EventStart);
        Assert.Equal("2025-11-02T06:30:00.000Z", shell.Calendar.EventEnd);

        store.SaveCalendarProfile(id, store.GetCalendarProfile(id) with { CurrentTime = "2025-03-09T12:00:00Z" });
        await shell.Calendar.RefreshCommand.ExecuteAsync(null);
        var savedStart = shell.Calendar.EventStart;
        var savedEnd = shell.Calendar.EventEnd;
        await shell.Calendar.CreateWeekEventAsync(6, 150);
        Assert.Contains("does not exist", shell.Error);
        Assert.Equal(savedStart, shell.Calendar.EventStart);
        Assert.Equal(savedEnd, shell.Calendar.EventEnd);
    }

    private sealed class TestPlatform : IPlatformServices
    {
        public void Post(Action action) => action();
        public Task<bool> ConfirmAsync(string title, string message) => Task.FromResult(true);
        public Task CopyTextAsync(string text) => Task.CompletedTask;
        public Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync) => Task.FromResult(true);
    }
}
