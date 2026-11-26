using System.Globalization;

namespace Mockarium.Core.Storage;

public sealed partial class MockariumStore
{
    public CalendarState? GetCalendar(string workspaceId)
    {
        lock (_gate)
        {
            GetWorkspace(workspaceId);
            if (!ListServers(workspaceId).Any(server => server.Type == "calendar")) return null;
            return new CalendarState(GetCalendarProfile(workspaceId), ListCalendarPeople(workspaceId),
                ListCalendarEvents(workspaceId, includeCancelled: true));
        }
    }

    public CalendarProfile GetCalendarProfile(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            return Query(
                """
                SELECT name, email, time_zone, work_start, work_end, simulated_time
                FROM calendar_profiles WHERE workspace_id = $workspace
                """,
                row => new CalendarProfile(row.GetString(0), row.GetString(1), row.GetString(2),
                    row.GetString(3), row.GetString(4), row.GetString(5)),
                ("$workspace", workspaceId)).SingleOrDefault()
                ?? throw new InvalidOperationException("The calendar owner is missing.");
        }
    }

    public CalendarProfile SaveCalendarProfile(string workspaceId, CalendarProfile profile)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            ArgumentNullException.ThrowIfNull(profile);
            var name = RequiredText(profile.Name, "Owner name", 80);
            var email = profile.Email?.Trim();
            CheckEmail(email, "Owner email");
            var zone = CheckTimeZone(profile.TimeZone);
            CheckWorkingHours(profile.WorkStart, profile.WorkEnd);
            var current = NormalizeInstant(profile.CurrentTime, "Simulated time");
            var previous = GetCalendarProfile(workspaceId);
            var clash = ListCalendarPeople(workspaceId)
                .FirstOrDefault(person => string.Equals(person.Email, email, StringComparison.OrdinalIgnoreCase));
            if (clash is not null)
                throw new InvalidOperationException($"{clash.Name} already uses {email}. Choose another address for the calendar owner.");
            InTransaction(() =>
            {
                Execute(
                    """
                    UPDATE calendar_profiles SET name = $name, email = $email, time_zone = $zone,
                      work_start = $start, work_end = $end, simulated_time = $time WHERE workspace_id = $workspace
                    """,
                    ("$workspace", workspaceId), ("$name", name), ("$email", email), ("$zone", zone),
                    ("$start", profile.WorkStart), ("$end", profile.WorkEnd), ("$time", current));
                RenameCalendarParticipant(workspaceId, previous.Email, email!);
            });
            return new CalendarProfile(name, email!, zone, profile.WorkStart, profile.WorkEnd, current);
        }
    }

    public IReadOnlyList<CalendarPerson> ListCalendarPeople(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            return Query(
                """
                SELECT id, name, email, company, time_zone, work_start, work_end
                FROM calendar_people WHERE workspace_id = $workspace ORDER BY name COLLATE NOCASE
                """,
                row => new CalendarPerson(row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3),
                    row.GetString(4), row.GetString(5), row.GetString(6)),
                ("$workspace", workspaceId));
        }
    }

    public CalendarPerson SaveCalendarPerson(string workspaceId, string? personId, CalendarPersonInput person)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            ArgumentNullException.ThrowIfNull(person);
            var name = RequiredText(person.Name, "Person name", 80);
            var email = person.Email?.Trim();
            CheckEmail(email, "Person email");
            var company = person.Company?.Trim() ?? throw new ArgumentException("Company is required.");
            if (company.Length > 120) throw new ArgumentException("Company is too long.");
            var zone = CheckTimeZone(person.TimeZone);
            CheckWorkingHours(person.WorkStart, person.WorkEnd);
            var people = ListCalendarPeople(workspaceId);
            var existing = personId is null ? null : people.FirstOrDefault(candidate => candidate.Id == personId);
            if (personId is not null && existing is null) throw new InvalidOperationException("Person not found.");
            if (personId is null && people.Count >= 50) throw new InvalidOperationException("A calendar can include up to 50 people.");
            if (string.Equals(GetCalendarProfile(workspaceId).Email, email, StringComparison.OrdinalIgnoreCase) ||
                people.Any(candidate => candidate.Id != personId && string.Equals(candidate.Email, email, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Someone in this calendar already uses that email.");
            var saved = new CalendarPerson(personId ?? NewId(), name, email!, company, zone, person.WorkStart, person.WorkEnd);
            InTransaction(() =>
            {
                UpsertCalendarPerson(workspaceId, saved);
                if (existing is not null) RenameCalendarParticipant(workspaceId, existing.Email, saved.Email);
            });
            return saved;
        }
    }

    public void DeleteCalendarPerson(string workspaceId, string personId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            var person = ListCalendarPeople(workspaceId).FirstOrDefault(candidate => candidate.Id == personId)
                ?? throw new InvalidOperationException("Person not found.");
            var events = ListCalendarEvents(workspaceId, includeCancelled: true);
            var organized = events.Count(item => string.Equals(item.OrganizerEmail, person.Email, StringComparison.OrdinalIgnoreCase));
            if (organized > 0)
                throw new InvalidOperationException($"{person.Name} organizes {organized} event(s). Change the organizer or delete them first.");
            InTransaction(() =>
            {
                foreach (var item in events)
                {
                    var attendees = item.Attendees.Where(attendee =>
                        !string.Equals(attendee.Email, person.Email, StringComparison.OrdinalIgnoreCase)).ToArray();
                    if (attendees.Length != item.Attendees.Count)
                        Execute("UPDATE calendar_events SET attendees_json = $attendees WHERE workspace_id = $workspace AND id = $id",
                            ("$attendees", MockariumJson.Serialize(attendees)), ("$workspace", workspaceId), ("$id", item.Id));
                }
                Execute("DELETE FROM calendar_people WHERE workspace_id = $workspace AND id = $id",
                    ("$workspace", workspaceId), ("$id", personId));
            });
        }
    }

    private void RenameCalendarParticipant(string workspaceId, string previous, string next)
    {
        if (previous == next) return;
        foreach (var item in ListCalendarEvents(workspaceId, includeCancelled: true))
        {
            var organizer = string.Equals(item.OrganizerEmail, previous, StringComparison.OrdinalIgnoreCase)
                ? next : item.OrganizerEmail;
            var attendees = item.Attendees.Select(attendee =>
                string.Equals(attendee.Email, previous, StringComparison.OrdinalIgnoreCase)
                    ? attendee with { Email = next } : attendee).ToArray();
            Execute(
                "UPDATE calendar_events SET organizer_email = $organizer, attendees_json = $attendees WHERE workspace_id = $workspace AND id = $id",
                ("$organizer", organizer), ("$attendees", MockariumJson.Serialize(attendees)),
                ("$workspace", workspaceId), ("$id", item.Id));
        }
    }

    public IReadOnlyList<CalendarEvent> ListCalendarEvents(
        string workspaceId, string? from = null, string? to = null, string? query = null,
        string? participant = null, bool includeCancelled = false)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            var events = Query(
                """
                SELECT id, title, description, location, start_at, end_at, organizer_email,
                       attendees_json, status, updated_at, updated_by
                FROM calendar_events WHERE workspace_id = $workspace
                  AND ($to IS NULL OR start_at < $to) AND ($from IS NULL OR end_at > $from)
                  AND ($cancelled = 1 OR status = 'confirmed')
                  AND ($query IS NULL OR instr(lower(title), lower($query)) > 0
                       OR instr(lower(description), lower($query)) > 0 OR instr(lower(location), lower($query)) > 0)
                ORDER BY start_at, title
                """,
                row => new CalendarEvent(
                    row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3), row.GetString(4),
                    row.GetString(5), row.GetString(6), MockariumJson.Deserialize<List<CalendarAttendee>>(row.GetString(7)),
                    row.GetString(8), row.GetString(9), row.GetString(10)),
                ("$workspace", workspaceId),
                ("$from", from is null ? null : NormalizeInstant(from, "Start")),
                ("$to", to is null ? null : NormalizeInstant(to, "End")),
                ("$query", string.IsNullOrEmpty(query) ? null : query),
                ("$cancelled", includeCancelled ? 1 : 0));
            if (string.IsNullOrEmpty(participant)) return events;
            return events.Where(item =>
                string.Equals(item.OrganizerEmail, participant, StringComparison.OrdinalIgnoreCase) ||
                item.Attendees.Any(attendee => string.Equals(attendee.Email, participant, StringComparison.OrdinalIgnoreCase)))
                .ToArray();
        }
    }

    public CalendarEvent? GetCalendarEvent(string workspaceId, string eventId)
    {
        lock (_gate)
            return ListCalendarEvents(workspaceId, includeCancelled: true).FirstOrDefault(item => item.Id == eventId);
    }

    public CalendarEvent SaveCalendarEvent(
        string workspaceId, string? eventId, CalendarEventInput input, string updatedBy = "studio",
        CalendarEvent? expected = null)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            ArgumentNullException.ThrowIfNull(input);
            var title = RequiredText(input.Title, "Title", 200);
            if (input.Description is null || input.Description.Length > 5000) throw new ArgumentException("Description is too long.");
            var location = input.Location?.Trim() ?? throw new ArgumentException("Location is required.");
            if (location.Length > 200) throw new ArgumentException("Location is too long.");
            var start = NormalizeInstant(input.StartAt, "Start");
            var end = NormalizeInstant(input.EndAt, "End");
            var duration = DateTimeOffset.Parse(end, CultureInfo.InvariantCulture) - DateTimeOffset.Parse(start, CultureInfo.InvariantCulture);
            if (duration <= TimeSpan.Zero) throw new ArgumentException("The event must end after it starts.");
            if (duration > TimeSpan.FromDays(14)) throw new ArgumentException("Events can last at most 14 days.");
            var organizer = input.OrganizerEmail?.Trim();
            CheckEmail(organizer, "Organizer email");
            if (input.Attendees is null || input.Attendees.Count > 50) throw new ArgumentException("An event can include up to 50 attendees.");
            var attendees = new List<CalendarAttendee>();
            var emails = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { organizer! };
            foreach (var attendee in input.Attendees)
            {
                if (attendee is null) throw new ArgumentException("An attendee is missing.");
                var email = attendee.Email?.Trim();
                CheckEmail(email, "Attendee email");
                if (!emails.Add(email!))
                    throw new ArgumentException("Each attendee can be listed once, and the organizer is already attending.");
                if (attendee.Response is not ("needsAction" or "accepted" or "declined" or "tentative"))
                    throw new ArgumentException("Invalid invitation response.");
                attendees.Add(new CalendarAttendee(email!, attendee.Response));
            }
            if (input.Status is not ("confirmed" or "cancelled")) throw new ArgumentException("Invalid event status.");
            if (updatedBy is not ("studio" or "agent")) throw new ArgumentException("Invalid event author.");
            if (eventId is not null)
            {
                var existing = GetCalendarEvent(workspaceId, eventId)
                    ?? throw new InvalidOperationException("Event not found.");
                if (expected is not null) RequireUnchangedEvent(existing, expected);
            }
            if (eventId is null && Scalar<long>("SELECT COUNT(*) FROM calendar_events WHERE workspace_id = $workspace",
                ("$workspace", workspaceId)) >= 500)
                throw new InvalidOperationException("A calendar can hold up to 500 events.");
            var saved = new CalendarEvent(eventId ?? NewId(), title, input.Description, location, start, end,
                organizer!, attendees, input.Status, Now(), updatedBy);
            UpsertCalendarEvent(workspaceId, saved);
            return saved;
        }
    }

    public void DeleteCalendarEvent(string workspaceId, string eventId, CalendarEvent? expected = null)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            if (expected is not null)
            {
                var existing = GetCalendarEvent(workspaceId, eventId)
                    ?? throw new InvalidOperationException("Event not found.");
                RequireUnchangedEvent(existing, expected);
            }
            if (Execute("DELETE FROM calendar_events WHERE workspace_id = $workspace AND id = $id",
                ("$workspace", workspaceId), ("$id", eventId)) == 0)
                throw new InvalidOperationException("Event not found.");
        }

    }

    private static void RequireUnchangedEvent(CalendarEvent current, CalendarEvent expected)
    {
        if (current.Id != expected.Id ||
            MockariumJson.Serialize(current.ToInput()) != MockariumJson.Serialize(expected.ToInput()))
            throw new InvalidOperationException("This event changed while you were editing it. Refresh or reselect it before saving.");
    }

    public void ResetCalendar(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "calendar");
            InTransaction(() =>
            {
                Execute("DELETE FROM calendar_events WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM calendar_people WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM calendar_profiles WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                SeedCalendar(workspaceId);
            });
        }
    }

    private static string CheckTimeZone(string? value)
    {
        var zone = RequiredText(value, "Time zone", 100);
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
            throw new ArgumentException("Choose a valid IANA time zone, like Europe/London.");
        return zone;
    }

    private static void CheckWorkingHours(string? start, string? end)
    {
        if (!TimeOnly.TryParseExact(start, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var from) ||
            !TimeOnly.TryParseExact(end, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var to))
            throw new ArgumentException("Use working hours like 09:00.");
        if (from >= to) throw new ArgumentException("Working hours must end after they start.");
    }

    private void UpsertCalendarPerson(string workspaceId, CalendarPerson person) =>
        Execute(
            """
            INSERT INTO calendar_people (workspace_id, id, name, email, company, time_zone, work_start, work_end)
            VALUES ($workspace, $id, $name, $email, $company, $zone, $start, $end)
            ON CONFLICT(workspace_id, id) DO UPDATE SET name = excluded.name, email = excluded.email,
              company = excluded.company, time_zone = excluded.time_zone, work_start = excluded.work_start, work_end = excluded.work_end
            """,
            ("$workspace", workspaceId), ("$id", person.Id), ("$name", person.Name), ("$email", person.Email),
            ("$company", person.Company), ("$zone", person.TimeZone), ("$start", person.WorkStart), ("$end", person.WorkEnd));

    private void UpsertCalendarEvent(string workspaceId, CalendarEvent item) =>
        Execute(
            """
            INSERT INTO calendar_events
              (workspace_id, id, title, description, location, start_at, end_at, organizer_email, attendees_json, status, updated_at, updated_by)
            VALUES ($workspace, $id, $title, $description, $location, $start, $end, $organizer, $attendees, $status, $updated, $by)
            ON CONFLICT(workspace_id, id) DO UPDATE SET title = excluded.title, description = excluded.description,
              location = excluded.location, start_at = excluded.start_at, end_at = excluded.end_at,
              organizer_email = excluded.organizer_email, attendees_json = excluded.attendees_json, status = excluded.status,
              updated_at = excluded.updated_at, updated_by = excluded.updated_by
            """,
            ("$workspace", workspaceId), ("$id", item.Id), ("$title", item.Title), ("$description", item.Description),
            ("$location", item.Location), ("$start", item.StartAt), ("$end", item.EndAt),
            ("$organizer", item.OrganizerEmail), ("$attendees", MockariumJson.Serialize(item.Attendees)),
            ("$status", item.Status), ("$updated", item.UpdatedAt), ("$by", item.UpdatedBy));

    private void SeedCalendar(string workspaceId)
    {
        const string current = "2025-03-10T08:30:00.000Z";
        const string owner = "alex@example.test";
        Execute(
            """
            INSERT INTO calendar_profiles (workspace_id, name, email, time_zone, work_start, work_end, simulated_time)
            VALUES ($workspace, 'Alex Morgan', $owner, 'Europe/London', '09:00', '17:30', $current)
            """,
            ("$workspace", workspaceId), ("$owner", owner), ("$current", current));
        foreach (var person in new[]
        {
            new CalendarPerson("person-jordan", "Jordan Lee", "jordan.lee@example.test", "Northstar Labs", "America/New_York", "09:00", "17:00"),
            new CalendarPerson("person-priya", "Priya Shah", "priya.shah@example.test", "Brightline Supply", "Asia/Kolkata", "10:00", "18:30"),
            new CalendarPerson("person-morgan", "Morgan Chen", "morgan.chen@example.test", "Fieldwork Studio", "America/Los_Angeles", "08:30", "17:00")
        })
            UpsertCalendarPerson(workspaceId, person);
        foreach (var item in new[]
        {
            new CalendarEvent("event-product-sync", "Weekly product sync", "Roadmap check-in across product, design, and partners.", "Video call",
                "2025-03-10T16:00:00.000Z", "2025-03-10T16:30:00.000Z", owner,
                [new("jordan.lee@example.test", "accepted"), new("morgan.chen@example.test", "accepted")], "confirmed", current, "studio"),
            new CalendarEvent("event-vendor-review", "Vendor renewal review", "Walk through the updated support terms before signing.", "Video call",
                "2025-03-11T09:30:00.000Z", "2025-03-11T10:30:00.000Z", "priya.shah@example.test",
                [new(owner, "needsAction")], "confirmed", current, "studio"),
            new CalendarEvent("event-board-prep", "Northstar board prep", "Internal Northstar meeting.", "Northstar HQ",
                "2025-03-11T14:00:00.000Z", "2025-03-11T17:00:00.000Z", "jordan.lee@example.test", [], "confirmed", current, "studio"),
            new CalendarEvent("event-lunch", "Lunch with Sam", "", "Riverside Café",
                "2025-03-12T12:00:00.000Z", "2025-03-12T13:00:00.000Z", owner, [], "confirmed", current, "studio"),
            new CalendarEvent("event-focus", "Focus: Q3 launch plan", "Protected time to review launch dates.", "",
                "2025-03-12T14:00:00.000Z", "2025-03-12T16:00:00.000Z", owner, [], "confirmed", current, "studio"),
            new CalendarEvent("event-design-review", "Design review", "Revised mockups and accessibility checklist.", "Fieldwork Studio · Room 2",
                "2025-03-13T16:30:00.000Z", "2025-03-13T17:15:00.000Z", "morgan.chen@example.test",
                [new(owner, "accepted")], "confirmed", current, "studio"),
            new CalendarEvent("event-jordan-1on1", "Alex / Jordan 1:1", "", "Video call",
                "2025-03-14T13:00:00.000Z", "2025-03-14T13:30:00.000Z", "jordan.lee@example.test",
                [new(owner, "accepted")], "confirmed", current, "studio")
        })
            UpsertCalendarEvent(workspaceId, item);
    }
}
