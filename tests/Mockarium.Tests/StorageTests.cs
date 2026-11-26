using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mockarium.Core;
using Mockarium.Core.Storage;

namespace Mockarium.Tests;

public sealed class StorageTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"mockarium-dotnet-test-{Guid.NewGuid():N}");

    [Fact]
    public void DatabasePathUsesElectronNameWhenNoDatabaseExists()
    {
        Assert.Equal(
            Path.Combine(_directory, "mockarium", "mockarium.sqlite"),
            MockariumStore.ResolveDatabasePath(_directory));
    }

    [Theory]
    [InlineData("mockarium")]
    [InlineData("Mockarium")]
    public void DatabasePathReusesAnExistingDatabase(string directoryName)
    {
        var path = Path.Combine(_directory, directoryName, "mockarium.sqlite");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Fixtures", "legacy-electron.sqlite.fixture"), path);

        var resolved = MockariumStore.ResolveDatabasePath(_directory);
        using var store = new MockariumStore(resolved);
        Assert.Equal("Legacy Electron", Assert.Single(store.ListWorkspaces()).Name);
        Assert.Equal(path, resolved, ignoreCase: OperatingSystem.IsWindows() || OperatingSystem.IsMacOS());
    }

    [Fact]
    public void DatabasePathRefusesToChooseBetweenSeparateDatabases()
    {
        var original = Path.Combine(_directory, "mockarium", "mockarium.sqlite");
        var alternate = Path.Combine(_directory, "Mockarium", "mockarium.sqlite");
        Directory.CreateDirectory(Path.GetDirectoryName(original)!);
        Directory.CreateDirectory(Path.GetDirectoryName(alternate)!);
        File.WriteAllText(original, "original");
        if (File.Exists(alternate))
        {
            Assert.Equal(original, MockariumStore.ResolveDatabasePath(_directory));
            return;
        }

        File.WriteAllText(alternate, "alternate");
        var error = Assert.Throws<InvalidOperationException>(() => MockariumStore.ResolveDatabasePath(_directory));
        Assert.Contains(original, error.Message);
        Assert.Contains(alternate, error.Message);
        Assert.Equal("original", File.ReadAllText(original));
        Assert.Equal("alternate", File.ReadAllText(alternate));
    }

    [Fact]
    public void DatabasePathReportsAnInvalidExistingPath()
    {
        var alternate = Path.Combine(_directory, "Mockarium", "mockarium.sqlite");
        Directory.CreateDirectory(alternate);
        var error = Assert.Throws<IOException>(() => MockariumStore.ResolveDatabasePath(_directory));
        Assert.Contains("directory", error.Message);
    }

    private string DatabasePath
    {
        get
        {
            Directory.CreateDirectory(_directory);
            return Path.Combine(_directory, "test.sqlite");
        }
    }

    [Fact]
    public void AppearanceSurvivesRestartIndependentlyOfMotionAndWorkspace()
    {
        using (var store = new MockariumStore(DatabasePath))
        {
            Assert.False(store.GetNightMode());
            store.SetNightMode(true);
            store.CreateWorkspace("Studio");
        }
        using (var reopened = new MockariumStore(DatabasePath))
        {
            Assert.True(reopened.GetNightMode());
            Assert.False(reopened.GetReduceMotion());
            reopened.SetReduceMotion(true);
            reopened.SetNightMode(false);
        }
        using var day = new MockariumStore(DatabasePath);
        Assert.False(day.GetNightMode());
        Assert.True(day.GetReduceMotion());
    }

    [Fact]
    public void StudiosPersistAndRemainWorkspaceIsolated()
    {
        string firstId;
        using (var store = new MockariumStore(DatabasePath))
        {
            var first = store.CreateWorkspace("First");
            var second = store.CreateWorkspace("Second");
            firstId = first.Id;
            store.AddServer(first.Id, "email");
            store.AddServer(first.Id, "database");
            store.AddServer(first.Id, "calendar");
            store.SaveEmailProfile(first.Id, new EmailProfile("Taylor", "taylor@example.test"));
            store.CreateOutboundEmail(first.Id, "Sent", "sam@example.test", "Test", "Hello");
            Assert.Empty(store.ListServers(second.Id));
            Assert.Equal(3, store.SearchEmails(first.Id, folder: "Inbox").Count);
            Assert.Equal(3, store.GetDatabaseModel(first.Id)!.Tables.Count);
            Assert.Equal(7, store.GetCalendar(first.Id)!.Events.Count);
        }
        using (var reopened = new MockariumStore(DatabasePath))
        {
            Assert.Equal("taylor@example.test", reopened.GetEmailProfile(firstId).Email);
            Assert.Single(reopened.SearchEmails(firstId, folder: "Sent"));
            Assert.Equal(2, reopened.GetDatabaseRecords(firstId, "companies").Count);
            Assert.Equal("Europe/London", reopened.GetCalendarProfile(firstId).TimeZone);
        }
    }

    [Fact]
    public void DatabaseRejectsInvalidAndDanglingRelationships()
    {
        using var store = new MockariumStore(DatabasePath);
        var workspace = store.CreateWorkspace("Validation");
        store.AddServer(workspace.Id, "database");
        var values = Values(new { name = "Taylor", email = "taylor@example.test", role = "Founder", company = "company_northstar" });
        var contact = store.SaveDatabaseRecord(workspace.Id, "contacts", null, values);
        Assert.Throws<InvalidOperationException>(() => store.DeleteDatabaseRecord(workspace.Id, "companies", "company_northstar"));
        values["company"] = MockariumJson.Element("missing");
        Assert.Throws<ArgumentException>(() => store.SaveDatabaseRecord(workspace.Id, "contacts", contact.Id, values));
        values["unexpected"] = MockariumJson.Element(true);
        Assert.Throws<ArgumentException>(() => store.SaveDatabaseRecord(workspace.Id, "contacts", contact.Id, values));
    }

    [Fact]
    public void CalendarRenamesParticipantsAndResetKeepsHistory()
    {
        using var store = new MockariumStore(DatabasePath);
        var workspace = store.CreateWorkspace("Calendar");
        store.AddServer(workspace.Id, "calendar");
        var person = store.ListCalendarPeople(workspace.Id).Single(p => p.Id == "person-jordan");
        store.SaveCalendarPerson(workspace.Id, person.Id, person.ToInput() with { Email = "new-jordan@example.test" });
        Assert.Equal("new-jordan@example.test", store.GetCalendarEvent(workspace.Id, "event-board-prep")!.OrganizerEmail);
        Assert.Contains(store.GetCalendarEvent(workspace.Id, "event-product-sync")!.Attendees,
            attendee => attendee.Email == "new-jordan@example.test");
        Assert.Throws<InvalidOperationException>(() => store.DeleteCalendarPerson(workspace.Id, person.Id));
        store.RecordEvent(workspace.Id, "Calendar", "test", MockariumJson.Element(new { }), MockariumJson.Element(new { ok = true }), 2, null);
        store.ResetCalendar(workspace.Id);
        Assert.Single(store.ListEvents(workspace.Id));
        Assert.Equal("jordan.lee@example.test", store.GetCalendarEvent(workspace.Id, "event-board-prep")!.OrganizerEmail);
    }

    [Fact]
    public void MigratesLegacyServerCatalogWithoutLosingExistingData()
    {
        using (var connection = new SqliteConnection($"Data Source={DatabasePath}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE mock_servers (
                  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                  type TEXT NOT NULL CHECK (type = 'email'), name TEXT NOT NULL, created_at TEXT NOT NULL,
                  UNIQUE (workspace_id, type)
                );
                INSERT INTO workspaces VALUES ('legacy-workspace', 'Legacy', '2025-01-01', '2025-01-01');
                INSERT INTO mock_servers VALUES ('legacy-email', 'legacy-workspace', 'email', 'Email', '2025-01-01');
                """;
            command.ExecuteNonQuery();
        }
        using var store = new MockariumStore(DatabasePath);
        Assert.Equal("legacy-email", store.ListServers("legacy-workspace").Single().Id);
        Assert.Equal("calendar", store.AddServer("legacy-workspace", "calendar").Type);
        Assert.Equal("Legacy", store.GetWorkspace("legacy-workspace").Name);
    }

    [Fact]
    public void OpensElectronGeneratedDatabaseAndPreservesStudioDataAndHistory()
    {
        var fixture = Path.Combine(AppContext.BaseDirectory, "Fixtures", "legacy-electron.sqlite.fixture");
        File.Copy(fixture, DatabasePath);

        using var store = new MockariumStore(DatabasePath);
        var workspace = Assert.Single(store.ListWorkspaces());
        Assert.Equal("Legacy Electron", workspace.Name);
        Assert.Equal(workspace.Id, store.GetActiveWorkspaceId());
        Assert.Equal(3, store.ListServers(workspace.Id).Count);
        Assert.Equal("Alex Morgan", store.GetEmailProfile(workspace.Id).Name);
        Assert.Equal(3, store.SearchEmails(workspace.Id).Count);
        Assert.Equal(3, store.GetDatabaseModel(workspace.Id)!.Tables.Count);
        Assert.Equal(2, store.GetDatabaseRecords(workspace.Id, "companies").Count);
        Assert.Equal(7, store.GetCalendar(workspace.Id)!.Events.Count);
        Assert.Equal("search_emails", Assert.Single(store.ListEvents(workspace.Id)).ToolName);

        store.SaveEmailProfile(workspace.Id, new EmailProfile("Morgan", "morgan@example.test"));
        Assert.Equal("Morgan", store.GetEmailProfile(workspace.Id).Name);
    }

    private static Dictionary<string, JsonElement> Values<T>(T value) =>
        MockariumJson.Deserialize<Dictionary<string, JsonElement>>(MockariumJson.Serialize(value));

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
