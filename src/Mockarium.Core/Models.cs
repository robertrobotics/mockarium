using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Mockarium.Core;

public sealed record Workspace(string Id, string Name, string CreatedAt, string UpdatedAt);

public sealed record MockServer(
    string Id,
    string WorkspaceId,
    string Type,
    string Name,
    string CreatedAt,
    bool Running = false,
    string? Endpoint = null);

public sealed record DatabaseField(
    string Id,
    string Name,
    string Label,
    string Type,
    bool Required,
    string? RelationTo = null);

public sealed record DatabaseTable(
    string Id,
    string Name,
    string Label,
    IReadOnlyList<DatabaseField> Fields);

public sealed record DatabaseModel(IReadOnlyList<DatabaseTable> Tables);

public sealed record DatabaseRecord(string Id, Dictionary<string, JsonElement> Values)
{
    [JsonIgnore]
    public string Summary => Values.TryGetValue("name", out var name) && name.ValueKind == JsonValueKind.String
        ? name.GetString() ?? Id : Id;
}

public sealed record EmailProfile(string Name, string Email);

public sealed record EmailContact(string Name, string Email, string Company);

public sealed record EmailMessageInput(
    string Folder,
    string FromName,
    string FromEmail,
    string ToEmail,
    string Subject,
    string Body,
    string SentAt,
    string? ParentEmailId);

public sealed record EmailMessage(
    string Id,
    string WorkspaceId,
    string Folder,
    string FromName,
    string FromEmail,
    string ToEmail,
    string Subject,
    string Body,
    string SentAt,
    string? ParentEmailId)
{
    public EmailMessageInput ToInput() =>
        new(Folder, FromName, FromEmail, ToEmail, Subject, Body, SentAt, ParentEmailId);
}

public sealed record CalendarAttendee(string Email, string Response);

public sealed record CalendarProfile(
    string Name,
    string Email,
    string TimeZone,
    string WorkStart,
    string WorkEnd,
    string CurrentTime);

public sealed record CalendarPersonInput(
    string Name,
    string Email,
    string Company,
    string TimeZone,
    string WorkStart,
    string WorkEnd);

public sealed record CalendarPerson(
    string Id,
    string Name,
    string Email,
    string Company,
    string TimeZone,
    string WorkStart,
    string WorkEnd)
{
    public CalendarPersonInput ToInput() => new(Name, Email, Company, TimeZone, WorkStart, WorkEnd);
}

public sealed record CalendarEventInput(
    string Title,
    string Description,
    string Location,
    string StartAt,
    string EndAt,
    string OrganizerEmail,
    IReadOnlyList<CalendarAttendee> Attendees,
    string Status);

public sealed record CalendarEvent(
    string Id,
    string Title,
    string Description,
    string Location,
    string StartAt,
    string EndAt,
    string OrganizerEmail,
    IReadOnlyList<CalendarAttendee> Attendees,
    string Status,
    string UpdatedAt,
    string UpdatedBy)
{
    public CalendarEventInput ToInput() =>
        new(Title, Description, Location, StartAt, EndAt, OrganizerEmail, Attendees, Status);
}

public sealed record CalendarState(
    CalendarProfile Profile,
    IReadOnlyList<CalendarPerson> People,
    IReadOnlyList<CalendarEvent> Events);

public sealed record ExecutionEvent(
    string Id,
    string WorkspaceId,
    string ServerName,
    string ToolName,
    JsonElement Input,
    JsonElement? Output,
    int DurationMs,
    bool Success,
    string? Error,
    string CreatedAt)
{
    [JsonIgnore]
    public string Status => Success ? "Success" : "Error";
}

public static class MockariumJson
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
        TypeInfoResolver = new DefaultJsonTypeInfoResolver()
    };

    public static JsonSerializerOptions IndentedOptions { get; } = new(Options) { WriteIndented = true };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new InvalidDataException($"The stored {typeof(T).Name} is missing.");

    public static JsonElement Element<T>(T value) => JsonSerializer.SerializeToElement(value, Options);
}
