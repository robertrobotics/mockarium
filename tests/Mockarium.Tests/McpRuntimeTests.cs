using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Client;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.Tests;

public sealed class McpRuntimeTests
{
    [Fact]
    public async Task NullableInputsHavePortableSchemasAndAcceptExplicitNull()
    {
        using var store = new MockariumStore(":memory:");
        var workspace = store.CreateWorkspace("Nullable MCP");
        var emailServer = store.AddServer(workspace.Id, "email");
        var calendarServer = store.AddServer(workspace.Id, "calendar");
        await using var runtime = new McpRuntime(store, NullLoggerFactory.Instance);

        var offline = runtime.GetTools(workspace.Id, emailServer.Id)
            .Single(tool => tool.Name == "search_emails");
        AssertNullableType(offline.InputSchema.GetProperty("properties").GetProperty("query"), "string");
        Assert.DoesNotContain("query", offline.InputSchema.TryGetProperty("required", out var required)
            ? required.EnumerateArray().Select(value => value.GetString())
            : []);
        var calendarSchema = runtime.GetTools(workspace.Id, calendarServer.Id)
            .Single(tool => tool.Name == "calendar_create_event").InputSchema;
        var attendees = calendarSchema.GetProperty("properties").GetProperty("attendees");
        AssertNullableType(attendees, "array");
        AssertNullableType(attendees.GetProperty("items"), "string");

        var started = await runtime.StartAsync(workspace.Id, emailServer.Id);
        await using var client = await Connect(started.Endpoint!);
        var live = (await client.ListToolsAsync()).Single(tool => tool.Name == "search_emails");
        Assert.Equal(offline.InputSchema.GetRawText(), live.ProtocolTool.InputSchema.GetRawText());
        var result = await client.CallToolAsync("search_emails", new Dictionary<string, object?>
        {
            ["query"] = null, ["folder"] = null, ["limit"] = null
        });
        Assert.NotEqual(true, result.IsError);
        Assert.NotEmpty(Data(result).EnumerateArray());
    }

    private static void AssertNullableType(JsonElement schema, string nonNullType)
    {
        var types = schema.GetProperty("anyOf").EnumerateArray()
            .Select(branch => branch.GetProperty("type").GetString()).ToArray();
        Assert.Equal(new[] { nonNullType, "null" }, types);
    }

    [Fact]
    public async Task EmailServerExposesRealToolsAndCapturesStatefulCalls()
    {
        using var store = new MockariumStore(":memory:");
        var workspace = store.CreateWorkspace("Email MCP");
        var server = store.AddServer(workspace.Id, "email");
        store.SaveEmailProfile(workspace.Id, new EmailProfile("Taylor Quinn", "taylor@example.test"));
        await using var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var events = new List<ExecutionEvent>();
        runtime.ExecutionCaptured += (_, entry) => events.Add(entry);

        var offline = runtime.GetTools(workspace.Id, server.Id);
        Assert.Equal(7, offline.Count);
        Assert.Empty(store.ListEvents(workspace.Id));
        Assert.False(runtime.GetServer(workspace.Id, server.Id)!.Running);

        var started = await runtime.StartAsync(workspace.Id, server.Id);
        await using (var client = await Connect(started.Endpoint!))
        {
            var live = await client.ListToolsAsync();
            Assert.Equal(offline.Select(tool => tool.Name).Order(), live.Select(tool => tool.Name).Order());
            var result = await client.CallToolAsync("send_email", new Dictionary<string, object?>
            {
                ["to"] = "sam@example.test",
                ["subject"] = "  Integration follow-up  ",
                ["body"] = "A real MCP tool call changed the mailbox."
            });
            Assert.NotEqual(true, result.IsError);
            Assert.Equal("taylor@example.test", Data(result).GetProperty("fromEmail").GetString());
            Assert.Equal("  Integration follow-up  ", store.SearchEmails(workspace.Id, folder: "Sent").Single().Subject);

            var failure = await client.CallToolAsync("get_email", new Dictionary<string, object?> { ["email_id"] = "missing" });
            Assert.True(failure.IsError);
            Assert.Contains("No email was found", Data(failure).GetProperty("error").GetString());

            var messageId = store.SearchEmails(workspace.Id, folder: "Inbox").First().Id;
            Assert.NotEqual(true, (await client.CallToolAsync("search_emails",
                new Dictionary<string, object?> { ["query"] = "Planning" })).IsError);
            Assert.NotEqual(true, (await client.CallToolAsync("get_email",
                new Dictionary<string, object?> { ["email_id"] = messageId })).IsError);
            Assert.NotEqual(true, (await client.CallToolAsync("reply_to_email",
                new Dictionary<string, object?> { ["email_id"] = messageId, ["body"] = "Thanks for the update." })).IsError);
            Assert.NotEqual(true, (await client.CallToolAsync("create_draft",
                new Dictionary<string, object?> { ["to"] = "sam@example.test", ["subject"] = "Draft", ["body"] = "Not sent." })).IsError);
            Assert.NotEqual(true, (await client.CallToolAsync("list_folders",
                new Dictionary<string, object?>())).IsError);
            Assert.NotEqual(true, (await client.CallToolAsync("list_contacts",
                new Dictionary<string, object?> { ["query"] = "Morgan" })).IsError);
        }
        Assert.Equal(8, events.Count);
        Assert.Equal(8, store.ListEvents(workspace.Id).Count);
        await runtime.StopAsync(workspace.Id, server.Id);
        Assert.False(runtime.GetServer(workspace.Id, server.Id)!.Running);
    }

    [Fact]
    public async Task DatabaseServerExercisesItsCompleteToolSurface()
    {
        using var store = new MockariumStore(":memory:");
        var workspace = store.CreateWorkspace("Database MCP");
        var server = store.AddServer(workspace.Id, "database");
        await using var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var started = await runtime.StartAsync(workspace.Id, server.Id);
        await using var client = await Connect(started.Endpoint!);
        Assert.Equal(6, (await client.ListToolsAsync()).Count);

        var schema = await client.CallToolAsync("database_schema", new Dictionary<string, object?>());
        Assert.NotEqual(true, schema.IsError);
        Assert.Equal(3, Data(schema).GetProperty("tables").GetArrayLength());

        var list = await client.CallToolAsync("database_list_records", new Dictionary<string, object?>
        {
            ["table"] = "companies", ["query"] = "Northstar", ["limit"] = 1
        });
        Assert.NotEqual(true, list.IsError);

        var get = await client.CallToolAsync("database_get_record", new Dictionary<string, object?>
        {
            ["table"] = "companies", ["id"] = "company_northstar"
        });
        Assert.NotEqual(true, get.IsError);

        var update = await client.CallToolAsync("database_update_record", new Dictionary<string, object?>
        {
            ["table"] = "companies", ["id"] = "company_northstar",
            ["values"] = new { status = "Renewal" }
        });
        Assert.NotEqual(true, update.IsError);
        Assert.Equal("Renewal", store.GetDatabaseRecords(workspace.Id, "companies")
            .Single(record => record.Id == "company_northstar").Values["status"].GetString());

        var create = await client.CallToolAsync("database_create_record", new Dictionary<string, object?>
        {
            ["table"] = "companies",
            ["values"] = new { name = "Test Company", industry = "Research", website = "", status = "Prospect" }
        });
        Assert.NotEqual(true, create.IsError);
        var createdId = Data(create).GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(createdId));

        var delete = await client.CallToolAsync("database_delete_record", new Dictionary<string, object?>
        {
            ["table"] = "companies", ["id"] = createdId
        });
        Assert.NotEqual(true, delete.IsError);
        Assert.DoesNotContain(store.GetDatabaseRecords(workspace.Id, "companies"), record => record.Id == createdId);
        Assert.Equal(6, store.ListEvents(workspace.Id).Count);
    }

    [Fact]
    public async Task CalendarAvailabilityAndInvitationsWorkThroughMcp()
    {
        using var store = new MockariumStore(":memory:");
        var workspace = store.CreateWorkspace("Calendar MCP");
        var server = store.AddServer(workspace.Id, "calendar");
        await using var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var started = await runtime.StartAsync(workspace.Id, server.Id);
        await using var client = await Connect(started.Endpoint!);
        Assert.Equal(9, (await client.ListToolsAsync()).Count);

        Assert.NotEqual(true, (await client.CallToolAsync("calendar_get_context",
            new Dictionary<string, object?>())).IsError);
        Assert.NotEqual(true, (await client.CallToolAsync("calendar_list_people",
            new Dictionary<string, object?> { ["query"] = "Jordan" })).IsError);
        Assert.NotEqual(true, (await client.CallToolAsync("calendar_list_events",
            new Dictionary<string, object?> { ["limit"] = 10 })).IsError);
        Assert.NotEqual(true, (await client.CallToolAsync("calendar_get_event",
            new Dictionary<string, object?> { ["id"] = "event-board-prep" })).IsError);

        var result = await client.CallToolAsync("calendar_find_availability", new Dictionary<string, object?>
        {
            ["attendees"] = new[] { "jordan.lee@example.test" },
            ["durationMinutes"] = 60,
            ["limit"] = 3
        });
        Assert.NotEqual(true, result.IsError);
        Assert.Equal("2025-03-10T13:00:00.000Z",
            Data(result).GetProperty("slots")[0].GetProperty("startAt").GetString());

        var naive = await client.CallToolAsync("calendar_create_event", new Dictionary<string, object?>
        {
            ["title"] = "Kickoff",
            ["startAt"] = "2025-03-10T13:00:00",
            ["endAt"] = "2025-03-10T14:00:00"
        });
        Assert.True(naive.IsError);

        var created = await client.CallToolAsync("calendar_create_event", new Dictionary<string, object?>
        {
            ["title"] = "MCP lifecycle test",
            ["startAt"] = "2025-03-10T18:00:00Z",
            ["endAt"] = "2025-03-10T18:30:00Z"
        });
        Assert.NotEqual(true, created.IsError);
        var eventId = Data(created).GetProperty("event").GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(eventId));
        Assert.NotEqual(true, (await client.CallToolAsync("calendar_update_event", new Dictionary<string, object?>
        {
            ["id"] = eventId, ["title"] = "Updated MCP lifecycle test"
        })).IsError);
        Assert.NotEqual(true, (await client.CallToolAsync("calendar_cancel_event", new Dictionary<string, object?>
        {
            ["id"] = eventId, ["reason"] = "Test complete"
        })).IsError);

        var invitation = await client.CallToolAsync("calendar_respond_to_invitation", new Dictionary<string, object?>
        {
            ["id"] = "event-vendor-review",
            ["response"] = "accepted"
        });
        Assert.NotEqual(true, invitation.IsError);
        Assert.Equal("accepted", store.GetCalendarEvent(workspace.Id, "event-vendor-review")!.Attendees[0].Response);
        Assert.Equal(9, store.ListEvents(workspace.Id).Select(entry => entry.ToolName).Distinct().Count());
    }

    [Fact]
    public async Task ServerRejectsUntrustedHostsAndOrigins()
    {
        using var store = new MockariumStore(":memory:");
        var workspace = store.CreateWorkspace("Security");
        var server = store.AddServer(workspace.Id, "email");
        await using var runtime = new McpRuntime(store, NullLoggerFactory.Instance);
        var running = await runtime.StartAsync(workspace.Id, server.Id);
        using var client = new HttpClient();
        using var badOrigin = new HttpRequestMessage(HttpMethod.Get, running.Endpoint);
        badOrigin.Headers.Add("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(badOrigin)).StatusCode);
        using var badHost = new HttpRequestMessage(HttpMethod.Get, running.Endpoint);
        badHost.Headers.Host = "evil.example";
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(badHost)).StatusCode);
        Assert.True(McpRuntime.IsAllowedOrigin("http://localhost:3000"));
        Assert.False(McpRuntime.IsAllowedOrigin("http://localhost.evil.example"));
        Assert.False(McpRuntime.IsAllowedOrigin("http://user@localhost"));
    }

    private static async Task<McpClient> Connect(string endpoint) =>
        await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(endpoint),
            TransportMode = HttpTransportMode.StreamableHttp
        }));

    private static JsonElement Data(ModelContextProtocol.Protocol.CallToolResult result) =>
        result.StructuredContent!.Value.GetProperty("data");
}
