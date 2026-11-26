using Microsoft.Extensions.Logging.Abstractions;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;
using Mockarium.ViewModels;
using ModelContextProtocol.Client;

namespace Mockarium.Tests;

public sealed class ViewModelTests
{
    [Fact]
    public async Task OfflineSearchFindsToolInputsAndKeepsHiddenMessageDrafts()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "Workbench";
        await shell.CreateWorkspaceCommand.ExecuteAsync(null);
        var email = shell.Email;
        email.CreateStarterCommand.Execute(null);

        email.ToolSearch = " SUBJECT ";
        Assert.Contains(email.VisibleTools, tool => tool.Name == "send_email");
        email.ToolSearch = "unmatched input";
        Assert.True(email.NoMatchingTools);
        Assert.False(email.IsRunning);

        var message = email.Messages.First();
        email.SelectedMessage = message;
        email.Subject = "Pending local edit";
        email.MessageSearch = "no matching messages";
        Assert.Empty(email.Messages);
        email.MessageSearch = message.FromEmail;
        Assert.Equal(message.Id, email.SelectedMessage?.Id);
        Assert.Equal("Pending local edit", email.Subject);
        Assert.Empty(shell.Error);
    }

    [Fact]
    public async Task WorkspaceAndStudioCommandsCreateAndRunARealServer()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "Design";
        shell.CreateWorkspaceCommand.Execute(null);
        Assert.Equal("Design", shell.SelectedWorkspace?.Name);
        await shell.Email.ToggleServerCommand.ExecuteAsync(null);
        Assert.True(shell.Email.IsRunning);
        Assert.Equal(3, shell.Email.Messages.Count);
        await shell.Email.CopyConfigurationCommand.ExecuteAsync(null);
        Assert.Contains(shell.Email.Endpoint, platform.Clipboard);
        await shell.Email.ToggleServerCommand.ExecuteAsync(null);
        Assert.False(shell.Email.IsRunning);
        Assert.Equal("", shell.Error);
    }

    [Fact]
    public async Task UnsavedDatabaseModelBlocksServerUntilItIsSaved()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "Model";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Database.CreateStarterCommand.Execute(null);
        shell.Database.AddTableCommand.Execute(null);
        await shell.Database.ToggleServerCommand.ExecuteAsync(null);
        Assert.Contains("Save or discard", shell.Error);
        Assert.False(shell.Database.IsRunning);
        shell.Database.SaveModelCommand.Execute(null);
        Assert.Empty(shell.Error);
        await shell.Database.ToggleServerCommand.ExecuteAsync(null);
        Assert.True(shell.Database.IsRunning);
    }

    [Fact]
    public async Task InspectorClearsOnlyTheViewAndExportsSavedHistory()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "Inspector";
        shell.CreateWorkspaceCommand.Execute(null);
        var id = shell.SelectedWorkspace!.Id;
        store.RecordEvent(id, "Email", "search_emails", MockariumJson.Element(new { query = "test" }),
            MockariumJson.Element(new { found = true }), 2, null);
        shell.Inspector.TogglePauseCommand.Execute(null);
        shell.Inspector.TogglePauseCommand.Execute(null);
        Assert.Single(shell.Inspector.Events);
        shell.Inspector.ClearViewCommand.Execute(null);
        Assert.Empty(shell.Inspector.Events);
        Assert.Single(store.ListEvents(id));
        await shell.Inspector.ExportCommand.ExecuteAsync(null);
        Assert.Contains("search_emails", platform.SavedText);
        await shell.Inspector.ExportJsonLinesCommand.ExecuteAsync(null);
        Assert.EndsWith("\n", platform.SavedText);
        var line = Assert.Single(platform.SavedText.Split('\n', StringSplitOptions.RemoveEmptyEntries));
        using var document = System.Text.Json.JsonDocument.Parse(line);
        Assert.Equal("search_emails", document.RootElement.GetProperty("toolName").GetString());
    }

    [Fact]
    public async Task AgentChangesRefreshListsWithoutOverwritingEdits()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "Live edits";
        shell.CreateWorkspaceCommand.Execute(null);

        await shell.Email.ToggleServerCommand.ExecuteAsync(null);
        shell.Email.SelectedFolder = "Sent";
        shell.Email.Subject = "Unsent local edit";
        await using (var client = await Connect(shell.Email.Endpoint))
        {
            var result = await client.CallToolAsync("send_email", new Dictionary<string, object?>
            {
                ["to"] = "casey@example.test", ["subject"] = "Agent message", ["body"] = "Hello"
            });
            Assert.NotEqual(true, result.IsError);
        }
        Assert.Single(shell.Email.Messages);
        Assert.Equal("Unsent local edit", shell.Email.Subject);

        await shell.Database.ToggleServerCommand.ExecuteAsync(null);
        shell.Database.SelectedRecord = shell.Database.Records.First(record => record.Id == "company_northstar");
        var name = shell.Database.RecordFields.Single(field => field.Name == "name");
        name.Value = "My local edit";
        await using (var client = await Connect(shell.Database.Endpoint))
        {
            var result = await client.CallToolAsync("database_update_record", new Dictionary<string, object?>
            {
                ["table"] = "companies",
                ["id"] = "company_northstar",
                ["values"] = new { name = "Agent update" }
            });
            Assert.NotEqual(true, result.IsError);
        }
        Assert.Equal("Agent update", shell.Database.Records.Single(record => record.Id == "company_northstar").Summary);
        Assert.Equal("My local edit", name.Value);
        shell.Database.SaveRecordCommand.Execute(null);
        Assert.Contains("changed while you were editing", shell.Error);
        Assert.Equal("Agent update", store.GetDatabaseRecords(shell.SelectedWorkspace!.Id, "companies")
            .Single(record => record.Id == "company_northstar").Summary);

        await shell.Calendar.ToggleServerCommand.ExecuteAsync(null);
        var original = shell.Calendar.Events.First(item => item.OrganizerEmail == shell.Calendar.OwnerEmail);
        shell.Calendar.SelectedEvent = original;
        shell.Calendar.EventTitle = "My local event edit";
        await using (var client = await Connect(shell.Calendar.Endpoint))
        {
            var result = await client.CallToolAsync("calendar_update_event", new Dictionary<string, object?>
            {
                ["id"] = original.Id, ["title"] = "Agent event update"
            });
            Assert.NotEqual(true, result.IsError);
        }
        Assert.Equal("Agent event update", shell.Calendar.Events.Single(item => item.Id == original.Id).Title);
        Assert.Equal("My local event edit", shell.Calendar.EventTitle);
        shell.Calendar.SaveEventCommand.Execute(null);
        Assert.Contains("changed while you were editing", shell.Error);
        Assert.Equal("Agent event update", store.GetCalendarEvent(shell.SelectedWorkspace.Id, original.Id)!.Title);
    }

    [Fact]
    public async Task SavingOneCalendarSectionKeepsOtherDrafts()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        await using var shell = new DesktopViewModel(store, runtime, new TestPlatform(), NullLoggerFactory.Instance);
        shell.WorkspaceName = "Calendar drafts";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Calendar.CreateStarterCommand.Execute(null);
        var calendar = shell.Calendar;
        calendar.OwnerName = "Unsaved owner";
        calendar.PersonName = "Unsaved person";
        calendar.SelectedEvent = calendar.Events.First();
        calendar.EventTitle = "Saved event";
        calendar.SaveEventCommand.Execute(null);
        Assert.Empty(shell.Error);
        Assert.Equal("Unsaved owner", calendar.OwnerName);
        Assert.Equal("Unsaved person", calendar.PersonName);

        calendar.EventTitle = "Unsaved event";
        calendar.PersonEmail = "new@example.test";
        calendar.SavePersonCommand.Execute(null);
        Assert.Empty(shell.Error);
        Assert.Equal("Unsaved owner", calendar.OwnerName);
        Assert.Equal("Unsaved event", calendar.EventTitle);

        calendar.PersonName = "Another person draft";
        calendar.SaveProfileCommand.Execute(null);
        Assert.Empty(shell.Error);
        Assert.Equal("Another person draft", calendar.PersonName);
        Assert.Equal("Unsaved event", calendar.EventTitle);
    }

    [Fact]
    public async Task WorkspaceSwitchRefreshAndCloseProtectUnsavedDrafts()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "First";
        await shell.CreateWorkspaceCommand.ExecuteAsync(null);
        var first = shell.SelectedWorkspace!;
        shell.Email.CreateStarterCommand.Execute(null);
        shell.WorkspaceName = "Second";
        await shell.CreateWorkspaceCommand.ExecuteAsync(null);
        var second = shell.SelectedWorkspace!;
        shell.SelectedWorkspace = first;
        shell.Email.Subject = "Unfinished message";
        platform.ConfirmResult = false;

        shell.SelectedWorkspace = second;
        Assert.Equal(first.Id, shell.SelectedWorkspace!.Id);
        Assert.Equal("Unfinished message", shell.Email.Subject);
        Assert.False(await shell.ConfirmCloseAsync());
        await shell.Email.RefreshCommand.ExecuteAsync(null);
        Assert.Equal("Unfinished message", shell.Email.Subject);

        shell.WorkspaceName = "Renamed";
        shell.RenameWorkspaceCommand.Execute(null);
        Assert.Equal("Renamed", shell.SelectedWorkspace!.Name);
        Assert.Equal("Unfinished message", shell.Email.Subject);

        shell.WorkspaceName = "Third";
        await shell.CreateWorkspaceCommand.ExecuteAsync(null);
        Assert.Equal(2, shell.Workspaces.Count);
        Assert.Equal("Unfinished message", shell.Email.Subject);

        platform.ConfirmResult = true;
        shell.SelectedWorkspace = second;
        Assert.Equal(second.Id, shell.SelectedWorkspace!.Id);
        Assert.True(await shell.ConfirmCloseAsync());
    }

    [Fact]
    public async Task RemovingDatabaseTableConfirmsBeforeDiscardingRecordDraft()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "Table drafts";
        shell.CreateWorkspaceCommand.Execute(null);
        shell.Database.CreateStarterCommand.Execute(null);

        var database = shell.Database;
        var table = database.Tables.Single(item => item.Name == "companies");
        database.SelectedTable = table;
        database.SelectedRecord = database.Records.Single(record => record.Id == "company_northstar");
        database.RecordFields.Single(field => field.Name == "name").Value = "Unsaved company";

        platform.ConfirmResult = false;
        await database.RemoveTableCommand.ExecuteAsync(null);
        Assert.Contains(table, database.Tables);
        Assert.Same(table, database.SelectedTable);
        Assert.Equal("Unsaved company", database.RecordFields.Single(field => field.Name == "name").Value);

        platform.ConfirmResult = true;
        await database.RemoveTableCommand.ExecuteAsync(null);
        Assert.DoesNotContain(table, database.Tables);
        Assert.Null(database.SelectedRecord);
        Assert.NotEqual("Unsaved company", database.RecordFields.Single(field => field.Name == "name").Value);
        Assert.Empty(shell.Error);
    }

    [Fact]
    public async Task EditorSelectionsDiscardDraftsOnlyAfterConfirmation()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "Selection drafts";
        shell.CreateWorkspaceCommand.Execute(null);

        shell.Email.CreateStarterCommand.Execute(null);
        var email = shell.Email;
        var firstMessage = email.Messages[0];
        var nextMessage = email.Messages[1];
        email.SelectedMessage = firstMessage;
        email.Subject = "Unsaved email edit";
        platform.ConfirmResult = false;
        email.SelectedMessage = nextMessage;
        Assert.Equal(firstMessage.Id, email.SelectedMessage?.Id);
        Assert.Equal("Unsaved email edit", email.Subject);
        platform.ConfirmResult = true;
        email.SelectedMessage = nextMessage;
        Assert.Equal(nextMessage.Id, email.SelectedMessage?.Id);
        Assert.Equal(nextMessage.Subject, email.Subject);

        var firstContact = email.Contacts[0];
        var nextContact = email.Contacts[1];
        email.SelectedContact = firstContact;
        email.ContactName = "Unsaved contact edit";
        platform.ConfirmResult = false;
        email.SelectedContact = nextContact;
        Assert.Equal(firstContact.Email, email.SelectedContact?.Email);
        Assert.Equal("Unsaved contact edit", email.ContactName);
        platform.ConfirmResult = true;
        email.SelectedContact = nextContact;
        Assert.Equal(nextContact.Email, email.SelectedContact?.Email);
        Assert.Equal(nextContact.Name, email.ContactName);

        shell.Database.CreateStarterCommand.Execute(null);
        var database = shell.Database;
        database.SelectedTable = database.Tables.Single(item => item.Name == "companies");
        var firstRecord = database.Records[0];
        var nextRecord = database.Records[1];
        database.SelectedRecord = firstRecord;
        database.RecordFields.Single(item => item.Name == "name").Value = "Unsaved record edit";
        platform.ConfirmResult = false;
        database.SelectedRecord = nextRecord;
        Assert.Equal(firstRecord.Id, database.SelectedRecord?.Id);
        Assert.Equal("Unsaved record edit", database.RecordFields.Single(item => item.Name == "name").Value);
        platform.ConfirmResult = true;
        database.SelectedRecord = nextRecord;
        Assert.Equal(nextRecord.Id, database.SelectedRecord?.Id);
        Assert.NotEqual("Unsaved record edit", database.RecordFields.Single(item => item.Name == "name").Value);

        database.RecordFields.Single(item => item.Name == "name").Value = "Unsaved table draft";
        var nextTable = database.Tables.Single(item => item.Name == "contacts");
        platform.ConfirmResult = false;
        database.SelectedTable = nextTable;
        Assert.Equal("companies", database.SelectedTable?.Name);
        Assert.Equal("Unsaved table draft", database.RecordFields.Single(item => item.Name == "name").Value);
        platform.ConfirmResult = true;
        database.SelectedTable = nextTable;
        Assert.Equal("contacts", database.SelectedTable?.Name);
        Assert.DoesNotContain(database.RecordFields, item => item.Value == "Unsaved table draft");

        shell.Calendar.CreateStarterCommand.Execute(null);
        var calendar = shell.Calendar;
        var firstPerson = calendar.People[0];
        var nextPerson = calendar.People[1];
        calendar.SelectedPerson = firstPerson;
        calendar.PersonName = "Unsaved person edit";
        platform.ConfirmResult = false;
        calendar.SelectedPerson = nextPerson;
        Assert.Equal(firstPerson.Id, calendar.SelectedPerson?.Id);
        Assert.Equal("Unsaved person edit", calendar.PersonName);
        platform.ConfirmResult = true;
        calendar.SelectedPerson = nextPerson;
        Assert.Equal(nextPerson.Id, calendar.SelectedPerson?.Id);
        Assert.Equal(nextPerson.Name, calendar.PersonName);

        var firstEvent = calendar.Events[0];
        var nextEvent = calendar.Events[1];
        calendar.SelectedEvent = firstEvent;
        calendar.EventTitle = "Unsaved event edit";
        platform.ConfirmResult = false;
        calendar.SelectedEvent = nextEvent;
        Assert.Equal(firstEvent.Id, calendar.SelectedEvent?.Id);
        Assert.Equal("Unsaved event edit", calendar.EventTitle);
        platform.ConfirmResult = true;
        calendar.SelectedEvent = nextEvent;
        Assert.Equal(nextEvent.Id, calendar.SelectedEvent?.Id);
        Assert.Equal(nextEvent.Title, calendar.EventTitle);
        Assert.Empty(shell.Error);
    }

    [Fact]
    public async Task DestructiveStudioCommandsRequireConfirmationAndPreserveDraftsWhenDeclined()
    {
        var store = new MockariumStore(":memory:");
        var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var platform = new TestPlatform();
        await using var shell = new DesktopViewModel(store, runtime, platform, NullLoggerFactory.Instance);
        shell.WorkspaceName = "Delete confirmations";
        shell.CreateWorkspaceCommand.Execute(null);
        var workspaceId = shell.SelectedWorkspace!.Id;

        shell.Email.CreateStarterCommand.Execute(null);
        var email = shell.Email;
        var message = email.Messages.First();
        email.SelectedMessage = message;
        email.Subject = "Unsaved subject";
        platform.ConfirmResult = false;
        await email.DeleteMessageCommand.ExecuteAsync(null);
        Assert.Contains(store.SearchEmails(workspaceId), item => item.Id == message.Id);
        Assert.Equal("Unsaved subject", email.Subject);
        Assert.Contains("discard its unsaved changes", platform.Confirmations[^1].Message);

        platform.ConfirmResult = true;
        await email.DeleteMessageCommand.ExecuteAsync(null);
        Assert.DoesNotContain(store.SearchEmails(workspaceId), item => item.Id == message.Id);

        email.ContactName = "Casey Morgan";
        email.ContactEmail = "casey@example.test";
        email.ContactCompany = "Northstar Labs";
        email.SaveContactCommand.Execute(null);
        var contact = email.Contacts.Single(item => item.Email == "casey@example.test");
        email.ContactName = "Unsaved contact";
        platform.ConfirmResult = false;
        await email.DeleteContactCommand.ExecuteAsync(null);
        Assert.Contains(email.Contacts, item => item.Email == contact.Email);
        Assert.Equal("Unsaved contact", email.ContactName);
        platform.ConfirmResult = true;
        await email.DeleteContactCommand.ExecuteAsync(null);
        Assert.DoesNotContain(email.Contacts, item => item.Email == contact.Email);

        shell.Database.CreateStarterCommand.Execute(null);
        var database = shell.Database;
        database.SelectedTable = database.Tables.Single(item => item.Name == "contacts");
        database.SelectedRecord = database.Records.Single(item => item.Id == "contact_jordan");
        var recordName = database.RecordFields.Single(item => item.Name == "name");
        recordName.Value = "Unsaved record";
        platform.ConfirmResult = false;
        await database.DeleteRecordCommand.ExecuteAsync(null);
        Assert.Contains(store.GetDatabaseRecords(workspaceId, "contacts"), item => item.Id == "contact_jordan");
        Assert.Equal("Unsaved record", recordName.Value);
        platform.ConfirmResult = true;
        await database.DeleteRecordCommand.ExecuteAsync(null);
        Assert.DoesNotContain(store.GetDatabaseRecords(workspaceId, "contacts"), item => item.Id == "contact_jordan");

        shell.Calendar.CreateStarterCommand.Execute(null);
        var calendar = shell.Calendar;
        var eventToDelete = calendar.Events.First();
        calendar.SelectedEvent = eventToDelete;
        calendar.EventTitle = "Unsaved event";
        platform.ConfirmResult = false;
        await calendar.DeleteEventCommand.ExecuteAsync(null);
        Assert.Contains(calendar.Events, item => item.Id == eventToDelete.Id);
        Assert.Equal("Unsaved event", calendar.EventTitle);
        platform.ConfirmResult = true;
        await calendar.DeleteEventCommand.ExecuteAsync(null);
        Assert.DoesNotContain(calendar.Events, item => item.Id == eventToDelete.Id);

        calendar.PersonName = "Casey Morgan";
        calendar.PersonEmail = "casey@example.test";
        calendar.PersonCompany = "Northstar Labs";
        calendar.SavePersonCommand.Execute(null);
        var person = calendar.People.Single(item => item.Email == "casey@example.test");
        calendar.PersonName = "Unsaved person";
        platform.ConfirmResult = false;
        await calendar.DeletePersonCommand.ExecuteAsync(null);
        Assert.Contains(calendar.People, item => item.Id == person.Id);
        Assert.Equal("Unsaved person", calendar.PersonName);
        platform.ConfirmResult = true;
        await calendar.DeletePersonCommand.ExecuteAsync(null);
        Assert.DoesNotContain(calendar.People, item => item.Id == person.Id);
        Assert.Empty(shell.Error);
    }

    private static Task<McpClient> Connect(string endpoint) =>
        McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(endpoint),
            TransportMode = HttpTransportMode.StreamableHttp
        }));

    private sealed class TestPlatform : IPlatformServices
    {
        public string Clipboard { get; private set; } = "";
        public string SavedText { get; private set; } = "";
        public bool ConfirmResult { get; set; } = true;
        public List<(string Title, string Message)> Confirmations { get; } = [];
        public void Post(Action action) => action();
        public Task<bool> ConfirmAsync(string title, string message)
        {
            Confirmations.Add((title, message));
            return Task.FromResult(ConfirmResult);
        }
        public Task CopyTextAsync(string text) { Clipboard = text; return Task.CompletedTask; }
        public async Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync)
        {
            using var stream = new MemoryStream();
            await writeAsync(stream);
            SavedText = System.Text.Encoding.UTF8.GetString(stream.ToArray());
            return true;
        }
    }
}
