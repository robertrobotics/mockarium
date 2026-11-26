using System.ComponentModel;
using System.Globalization;
using System.Text.RegularExpressions;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Mockarium.Core.Mcp;

internal sealed class CalendarTools(ToolContext context)
{
    private sealed record Participant(string Name, string Email, string TimeZone, string WorkStart, string WorkEnd);

    [McpServerTool(Name = "calendar_get_context")]
    [Description("Get the calendar owner, simulated time, time zone, working hours, and visible people. Use this simulated time as now.")]
    public CallToolResult GetContext() =>
        context.Execute("calendar_get_context", new { }, () =>
        {
            var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
            var people = context.Store.ListCalendarPeople(context.WorkspaceId);
            return new
            {
                owner = new { profile.Name, profile.Email, profile.TimeZone, workingHours = Hours(profile.WorkStart, profile.WorkEnd) + " Mon-Fri" },
                now = profile.CurrentTime,
                nowLocal = $"{Format(profile.CurrentTime, profile.TimeZone)} ({profile.TimeZone})",
                people = people.Select(person => new
                {
                    person.Name, person.Email, person.Company, person.TimeZone,
                    workingHours = Hours(person.WorkStart, person.WorkEnd) + " Mon-Fri",
                    localTimeNow = Format(profile.CurrentTime, person.TimeZone)
                }).ToArray()
            };
        });

    [McpServerTool(Name = "calendar_list_people")]
    [Description("Search people whose calendars are visible, with email, company, time zone, and working hours.")]
    public CallToolResult ListPeople(string? query = null) =>
        context.Execute("calendar_list_people", new { query }, () =>
        {
            if (query?.Length > 200) throw new ArgumentException("Search text is too long.");
            return context.Store.ListCalendarPeople(context.WorkspaceId)
                .Where(person => string.IsNullOrEmpty(query) ||
                    $"{person.Name} {person.Email} {person.Company}".Contains(query, StringComparison.OrdinalIgnoreCase))
                .Select(person => new
                {
                    person.Name, person.Email, person.Company, person.TimeZone,
                    workingHours = Hours(person.WorkStart, person.WorkEnd) + " Mon-Fri"
                }).ToArray();
        });

    [McpServerTool(Name = "calendar_list_events")]
    [Description("List events between two date-times; defaults to the next seven days from simulated now.")]
    public CallToolResult ListEvents(
        string? from = null, string? to = null, string? query = null, string? participant = null,
        bool? includeCancelled = null, int? limit = null) =>
        context.Execute("calendar_list_events", new { from, to, query, participant, includeCancelled, limit }, () =>
        {
            if (query?.Length > 200) throw new ArgumentException("Search text is too long.");
            if (participant is not null) ValidateEmail(participant);
            if (limit is < 1 or > 200) throw new ArgumentException("Limit must be between 1 and 200.");
            var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
            var start = from is null ? ParseStored(profile.CurrentTime) : ParseInstant(from);
            var end = to is null ? start.AddDays(7) : ParseInstant(to);
            if (end <= start) throw new ArgumentException("\"to\" must be after \"from\".");
            return context.Store.ListCalendarEvents(context.WorkspaceId, Iso(start), Iso(end), query, participant, includeCancelled ?? false)
                .Take(limit ?? 50).Select(Present).ToArray();
        });

    [McpServerTool(Name = "calendar_get_event")]
    [Description("Get one event, including attendees and their responses.")]
    public CallToolResult GetEvent(string id) =>
        context.Execute("calendar_get_event", new { id }, () => Present(RequireEvent(id)));

    [McpServerTool(Name = "calendar_find_availability")]
    [Description("Find slots when the owner and listed people are free and inside each person's working hours, Monday to Friday.")]
    public CallToolResult FindAvailability(
        [Description("Emails of people who must attend, besides the owner.")] string[] attendees,
        [Description("Meeting duration from 15 to 480 minutes.")] int durationMinutes,
        string? from = null, string? to = null, int? limit = null) =>
        context.Execute("calendar_find_availability", new { attendees, durationMinutes, from, to, limit }, () =>
        {
            ValidateAttendees(attendees);
            if (durationMinutes is < 15 or > 480) throw new ArgumentException("Duration must be between 15 and 480 minutes.");
            if (limit is < 1 or > 20) throw new ArgumentException("Limit must be between 1 and 20.");
            var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
            var people = context.Store.ListCalendarPeople(context.WorkspaceId);
            var participants = new List<Participant>
            {
                new(profile.Name, profile.Email, profile.TimeZone, profile.WorkStart, profile.WorkEnd)
            };
            foreach (var email in attendees)
            {
                if (participants.Any(person => EqualEmail(person.Email, email))) continue;
                var person = people.FirstOrDefault(candidate => EqualEmail(candidate.Email, email))
                    ?? throw new InvalidOperationException(
                        $"No calendar is visible for {email}. Known people: {string.Join(", ", people.Select(candidate => candidate.Email))}.");
                participants.Add(new Participant(person.Name, person.Email, person.TimeZone, person.WorkStart, person.WorkEnd));
            }
            var start = from is null ? ParseStored(profile.CurrentTime) : ParseInstant(from);
            var end = to is null ? start.AddDays(7) : ParseInstant(to);
            if (end <= start) throw new ArgumentException("\"to\" must be after \"from\".");
            if (end - start > TimeSpan.FromDays(31)) throw new ArgumentException("Search at most 31 days at a time.");
            var involved = participants.Select(person => person.Email).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var busy = context.Store.ListCalendarEvents(context.WorkspaceId, Iso(start), Iso(end))
                .Where(item => ParticipantsOf(item).Any(involved.Contains)).ToArray();
            const long step = 30 * 60 * 1000;
            var first = ((start.ToUnixTimeMilliseconds() + step - 1) / step) * step;
            var slots = new List<object>();
            for (var instant = DateTimeOffset.FromUnixTimeMilliseconds(first);
                 instant.AddMinutes(durationMinutes) <= end && slots.Count < (limit ?? 5);
                 instant = instant.AddMinutes(30))
            {
                var until = instant.AddMinutes(durationMinutes);
                var free = participants.All(person => WithinWorkingHours(person, instant, until) &&
                    !busy.Any(item => ParticipantsOf(item).Contains(person.Email, StringComparer.OrdinalIgnoreCase) &&
                        Overlaps(instant, until, ParseStored(item.StartAt), ParseStored(item.EndAt))));
                if (!free) continue;
                slots.Add(new
                {
                    startAt = Iso(instant),
                    endAt = Iso(until),
                    localTimes = participants.ToDictionary(person => person.Email,
                        person => $"{Format(instant, person.TimeZone)} ({person.TimeZone})")
                });
            }
            return new
            {
                durationMinutes,
                participants = participants.Select(person => new
                {
                    person.Name, person.Email, person.TimeZone, workingHours = Hours(person.WorkStart, person.WorkEnd)
                }).ToArray(),
                slots,
                hint = slots.Count == 0 ? "No shared free time was found. Try a shorter meeting, fewer attendees, or a wider date range." : null
            };
        });

    [McpServerTool(Name = "calendar_create_event")]
    [Description("Create an event on the owner's calendar; attendees start with needsAction. The result lists scheduling conflicts.")]
    public CallToolResult CreateEvent(
        string title, string startAt, string endAt, string[]? attendees = null, string? location = null, string? description = null) =>
        context.Execute("calendar_create_event", new { title, startAt, endAt, attendees, location, description }, () =>
        {
            _ = ParseInstant(startAt);
            _ = ParseInstant(endAt);
            ValidateAttendees(attendees ?? []);
            var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
            var guests = (attendees ?? []).Where(email => !EqualEmail(email, profile.Email))
                .Distinct(StringComparer.OrdinalIgnoreCase).Select(email => new CalendarAttendee(email, "needsAction")).ToArray();
            var saved = context.Store.SaveCalendarEvent(context.WorkspaceId, null,
                new CalendarEventInput(title, description ?? "", location ?? "", startAt, endAt, profile.Email, guests, "confirmed"), "agent");
            return new { @event = Present(saved), conflicts = Conflicts(saved) };
        });

    [McpServerTool(Name = "calendar_update_event")]
    [Description("Reschedule or edit an event the owner organizes. Only provided fields change.")]
    public CallToolResult UpdateEvent(
        string id, string? title = null, string? startAt = null, string? endAt = null,
        string[]? attendees = null, string? location = null, string? description = null) =>
        context.Execute("calendar_update_event", new { id, title, startAt, endAt, attendees, location, description }, () =>
        {
            if (startAt is not null) _ = ParseInstant(startAt);
            if (endAt is not null) _ = ParseInstant(endAt);
            var existing = OwnedEvent(id);
            if (attendees is not null) ValidateAttendees(attendees);
            var guests = attendees is null ? existing.Attendees : attendees
                .Where(email => !EqualEmail(email, existing.OrganizerEmail))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(email => existing.Attendees.FirstOrDefault(attendee => EqualEmail(attendee.Email, email))
                    ?? new CalendarAttendee(email, "needsAction")).ToArray();
            var input = existing.ToInput() with
            {
                Title = title ?? existing.Title,
                StartAt = startAt ?? existing.StartAt,
                EndAt = endAt ?? existing.EndAt,
                Attendees = guests,
                Location = location ?? existing.Location,
                Description = description ?? existing.Description
            };
            var saved = context.Store.SaveCalendarEvent(context.WorkspaceId, id, input, "agent");
            return new { @event = Present(saved), conflicts = Conflicts(saved) };
        });

    [McpServerTool(Name = "calendar_cancel_event")]
    [Description("Cancel an event the owner organizes, optionally giving a reason.")]
    public CallToolResult CancelEvent(string id, string? reason = null) =>
        context.Execute("calendar_cancel_event", new { id, reason }, () =>
        {
            if (reason?.Length > 500) throw new ArgumentException("The cancellation reason is too long.");
            var existing = OwnedEvent(id);
            var description = string.IsNullOrEmpty(reason) ? existing.Description :
                $"Cancelled: {reason}{(string.IsNullOrEmpty(existing.Description) ? "" : $"\n\n{existing.Description}")}";
            var saved = context.Store.SaveCalendarEvent(context.WorkspaceId, id,
                existing.ToInput() with { Description = description, Status = "cancelled" }, "agent");
            return new { cancelled = true, @event = Present(saved) };
        });

    [McpServerTool(Name = "calendar_respond_to_invitation")]
    [Description("Accept, decline, or tentatively accept an invitation on the owner's behalf.")]
    public CallToolResult RespondToInvitation(string id, string response) =>
        context.Execute("calendar_respond_to_invitation", new { id, response }, () =>
        {
            if (response is not ("accepted" or "declined" or "tentative")) throw new ArgumentException("Invalid invitation response.");
            var existing = RequireEvent(id);
            var owner = context.Store.GetCalendarProfile(context.WorkspaceId).Email;
            if (EqualEmail(existing.OrganizerEmail, owner))
                throw new InvalidOperationException($"The owner organizes \"{existing.Title}\", so there is no invitation to answer.");
            if (!existing.Attendees.Any(attendee => EqualEmail(attendee.Email, owner)))
                throw new InvalidOperationException($"The owner is not invited to \"{existing.Title}\".");
            if (existing.Status == "cancelled") throw new InvalidOperationException($"\"{existing.Title}\" has been cancelled.");
            var guests = existing.Attendees.Select(attendee => EqualEmail(attendee.Email, owner)
                ? attendee with { Response = response } : attendee).ToArray();
            var saved = context.Store.SaveCalendarEvent(context.WorkspaceId, id,
                existing.ToInput() with { Attendees = guests }, "agent");
            return new { @event = Present(saved) };
        });

    private object Present(CalendarEvent item)
    {
        var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
        var people = context.Store.ListCalendarPeople(context.WorkspaceId);
        string Name(string email) => EqualEmail(email, profile.Email) ? profile.Name :
            people.FirstOrDefault(person => EqualEmail(person.Email, email))?.Name ?? email;
        return new
        {
            item.Id, item.Title, item.Status, item.StartAt, item.EndAt,
            localTime = $"{Format(item.StartAt, profile.TimeZone)} - {Format(item.EndAt, profile.TimeZone)} ({profile.TimeZone})",
            item.Location, item.Description,
            organizer = new { name = Name(item.OrganizerEmail), email = item.OrganizerEmail },
            attendees = item.Attendees.Select(attendee => new { name = Name(attendee.Email), attendee.Email, attendee.Response }).ToArray()
        };
    }

    private object[] Conflicts(CalendarEvent item)
    {
        var profile = context.Store.GetCalendarProfile(context.WorkspaceId);
        var people = context.Store.ListCalendarPeople(context.WorkspaceId);
        string Name(string email) => EqualEmail(email, profile.Email) ? profile.Name :
            people.FirstOrDefault(person => EqualEmail(person.Email, email))?.Name ?? email;
        var involved = ParticipantsOf(item).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return context.Store.ListCalendarEvents(context.WorkspaceId, item.StartAt, item.EndAt)
            .Where(other => other.Id != item.Id &&
                Overlaps(ParseStored(item.StartAt), ParseStored(item.EndAt), ParseStored(other.StartAt), ParseStored(other.EndAt)))
            .Select(other => new
            {
                other.Id, other.Title, other.StartAt, other.EndAt,
                busyPeople = ParticipantsOf(other).Where(involved.Contains).Select(Name).ToArray()
            })
            .Where(conflict => conflict.busyPeople.Length > 0).Cast<object>().ToArray();
    }

    private CalendarEvent RequireEvent(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 100) throw new ArgumentException("Event ID is invalid.");
        return context.Store.GetCalendarEvent(context.WorkspaceId, id)
            ?? throw new InvalidOperationException($"Event \"{id}\" was not found.");
    }

    private CalendarEvent OwnedEvent(string id)
    {
        var item = RequireEvent(id);
        var owner = context.Store.GetCalendarProfile(context.WorkspaceId);
        if (!EqualEmail(item.OrganizerEmail, owner.Email))
            throw new InvalidOperationException($"Only the organizer can change \"{item.Title}\". Use calendar_respond_to_invitation instead.");
        if (item.Status == "cancelled") throw new InvalidOperationException($"\"{item.Title}\" has already been cancelled.");
        return item;
    }

    private static IEnumerable<string> ParticipantsOf(CalendarEvent item) =>
        [item.OrganizerEmail, .. item.Attendees.Where(attendee => attendee.Response != "declined").Select(attendee => attendee.Email)];

    private static bool WithinWorkingHours(Participant person, DateTimeOffset start, DateTimeOffset end)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(person.TimeZone);
        var first = TimeZoneInfo.ConvertTime(start, zone);
        var last = TimeZoneInfo.ConvertTime(end.AddMinutes(-1), zone);
        if (first.Date != last.Date || first.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return false;
        var workStart = TimeOnly.ParseExact(person.WorkStart, "HH:mm", CultureInfo.InvariantCulture);
        var workEnd = TimeOnly.ParseExact(person.WorkEnd, "HH:mm", CultureInfo.InvariantCulture);
        return first.Hour * 60 + first.Minute >= workStart.Hour * 60 + workStart.Minute &&
            last.Hour * 60 + last.Minute + 1 <= workEnd.Hour * 60 + workEnd.Minute;
    }

    private static bool Overlaps(DateTimeOffset firstStart, DateTimeOffset firstEnd, DateTimeOffset secondStart, DateTimeOffset secondEnd) =>
        firstStart < secondEnd && secondStart < firstEnd;

    private static bool EqualEmail(string left, string right) => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    private static string Hours(string start, string end) => $"{start}-{end}";
    private static string Format(string value, string zone) => Format(ParseStored(value), zone);
    private static string Format(DateTimeOffset value, string zone) =>
        TimeZoneInfo.ConvertTime(value, TimeZoneInfo.FindSystemTimeZoneById(zone))
            .ToString("ddd, MMM d, HH:mm", CultureInfo.GetCultureInfo("en-US"));
    private static string Iso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private static DateTimeOffset ParseStored(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseInstant(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 40 ||
            !Regex.IsMatch(value, @"T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.CultureInvariant) ||
            !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var result))
            throw new ArgumentException("Use an ISO 8601 date-time with a UTC offset, for example 2025-03-12T15:00:00Z.");
        return result;
    }

    private static void ValidateAttendees(string[] attendees)
    {
        ArgumentNullException.ThrowIfNull(attendees);
        if (attendees.Length > 20) throw new ArgumentException("At most 20 attendees are allowed.");
        foreach (var email in attendees) ValidateEmail(email);
    }

    private static void ValidateEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254 ||
            !Regex.IsMatch(email.Trim(), @"^[^\s@]+@[^\s@]+\.[^\s@]+$", RegexOptions.CultureInvariant))
            throw new ArgumentException("Use a valid email address.");
    }
}
