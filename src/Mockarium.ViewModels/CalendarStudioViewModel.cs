using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed partial class CalendarStudioViewModel : StudioViewModel
{
    private bool _loading;
    private string? _editingPersonId;
    private string? _editingEventId;
    private CalendarEvent? _editingEvent;
    private CalendarProfile? _savedProfile;
    private CalendarPersonInput? _savedPersonForm;
    private EventForm? _savedEventForm;
    private bool _changingPerson;
    private bool _changingEvent;

    private sealed record EventForm(
        string Title, string Description, string Location, string Start, string End,
        string Organizer, string Attendees, string Status);

    [ObservableProperty] private string ownerName = "";
    [ObservableProperty] private string ownerEmail = "";
    [ObservableProperty] private string ownerTimeZone = "";
    [ObservableProperty] private string workStart = "";
    [ObservableProperty] private string workEnd = "";
    [ObservableProperty] private string simulatedTime = "";
    [ObservableProperty] private CalendarPerson? selectedPerson;
    [ObservableProperty] private string personName = "";
    [ObservableProperty] private string personEmail = "";
    [ObservableProperty] private string personCompany = "";
    [ObservableProperty] private string personTimeZone = "";
    [ObservableProperty] private string personWorkStart = "09:00";
    [ObservableProperty] private string personWorkEnd = "17:00";
    [ObservableProperty] private CalendarEvent? selectedEvent;
    [ObservableProperty] private string eventTitle = "";
    [ObservableProperty] private string eventDescription = "";
    [ObservableProperty] private string eventLocation = "";
    [ObservableProperty] private string eventStart = "";
    [ObservableProperty] private string eventEnd = "";
    [ObservableProperty] private string eventOrganizer = "";
    [ObservableProperty] private string eventAttendees = "";
    [ObservableProperty] private string eventStatus = "confirmed";
    [ObservableProperty] private int weekOffset;
    [ObservableProperty] private int selectedCalendarTabIndex;
    [ObservableProperty] private string weekLabel = "";
    [ObservableProperty] private string weekTimeZone = "";
    [ObservableProperty] private IReadOnlyList<CalendarWeekDay> weekDays = [];
    [ObservableProperty] private IReadOnlyList<CalendarWeekBlock> weekBlocks = [];

    public CalendarStudioViewModel(DesktopViewModel shell, MockariumStore store, McpRuntime runtime, IPlatformServices platform)
        : base(shell, store, runtime, platform, "calendar", "Calendar Studio",
            "Plan a believable week across people, time zones, and invitations.", "◷") { }

    public ObservableCollection<CalendarPerson> People { get; } = [];
    public ObservableCollection<CalendarEvent> Events { get; } = [];
    public IReadOnlyList<string> EventStatuses { get; } = ["confirmed", "cancelled"];
    private bool PersonHasChanges => _savedPersonForm is not null && _savedPersonForm != CurrentPersonForm();
    private bool EventHasChanges => _savedEventForm is not null && _savedEventForm != CurrentEventForm();
    internal override bool HasUnsavedChanges => IsConfigured &&
        (_savedProfile != CurrentProfileForm() || PersonHasChanges || EventHasChanges);

    private CalendarProfile CurrentProfileForm() =>
        new(OwnerName, OwnerEmail, OwnerTimeZone, WorkStart, WorkEnd, SimulatedTime);
    private CalendarPersonInput CurrentPersonForm() =>
        new(PersonName, PersonEmail, PersonCompany, PersonTimeZone, PersonWorkStart, PersonWorkEnd);
    private EventForm CurrentEventForm() =>
        new(EventTitle, EventDescription, EventLocation, EventStart, EventEnd, EventOrganizer, EventAttendees, EventStatus);

    protected override void LoadData()
    {
        _loading = true;
        try
        {
            People.Clear();
            Events.Clear();
            SelectedPerson = null;
            SelectedEvent = null;
            _editingPersonId = _editingEventId = null;
            _editingEvent = null;
            _savedProfile = null;
            _savedPersonForm = null;
            _savedEventForm = null;
            if (!HasWorkspace || !IsConfigured)
            {
                OwnerName = OwnerEmail = OwnerTimeZone = WorkStart = WorkEnd = SimulatedTime = "";
                return;
            }
            var calendar = Store.GetCalendar(WorkspaceId) ?? throw new InvalidOperationException("The calendar is missing.");
            ApplyProfile(calendar.Profile);
            foreach (var person in calendar.People) People.Add(person);
            foreach (var item in calendar.Events) Events.Add(item);
        }
        finally
        {
            _loading = false;
            RebuildWeek();
        }
        ResetPerson();
        ResetEvent();
    }

    protected override void ResetData() => Store.ResetCalendar(WorkspaceId);

    internal override void OnAgentExecution(ExecutionEvent entry)
    {
        if (entry.ToolName is not ("calendar_create_event" or "calendar_update_event" or
            "calendar_cancel_event" or "calendar_respond_to_invitation")) return;
        var selectedId = _editingEventId;
        RefreshEvents();
        if (selectedId is not null && entry.Input.TryGetProperty("id", out var id) && id.GetString() == selectedId)
            Shell.Notice = "An agent changed the event you are editing. Refresh or reselect it before saving.";
    }

    private void RefreshEvents()
    {
        var selectedId = _editingEventId;
        _loading = true;
        try
        {
            Events.Clear();
            foreach (var item in Store.ListCalendarEvents(WorkspaceId, includeCancelled: true)) Events.Add(item);
            SelectedEvent = Events.FirstOrDefault(item => item.Id == selectedId);
        }
        finally
        {
            _loading = false;
        }
        RebuildWeek();
    }

    private void RefreshPeople()
    {
        var selectedId = _editingPersonId;
        _loading = true;
        try
        {
            People.Clear();
            foreach (var person in Store.ListCalendarPeople(WorkspaceId)) People.Add(person);
            SelectedPerson = People.FirstOrDefault(person => person.Id == selectedId);
        }
        finally
        {
            _loading = false;
        }
    }

    private void ApplyProfile(CalendarProfile profile)
    {
        _savedProfile = profile;
        OwnerName = profile.Name;
        OwnerEmail = profile.Email;
        OwnerTimeZone = profile.TimeZone;
        WorkStart = profile.WorkStart;
        WorkEnd = profile.WorkEnd;
        SimulatedTime = profile.CurrentTime;
    }

    partial void OnWeekOffsetChanged(int value) => RebuildWeek();

    [RelayCommand] private void PreviousWeek() => WeekOffset--;
    [RelayCommand] private void NextWeek() => WeekOffset++;
    [RelayCommand] private void ThisWeek() => WeekOffset = 0;
    [RelayCommand] private async Task NewEventFromWeekAsync() => await Shell.RunAsync(async () =>
    {
        if (!await ConfirmDiscardAsync(EventHasChanges, "event changes")) return;
        ResetEvent();
        SelectedCalendarTabIndex = 1;
    });

    private void RebuildWeek()
    {
        if (_savedProfile is null)
        {
            WeekDays = [];
            WeekBlocks = [];
            WeekLabel = WeekTimeZone = "";
            return;
        }
        var zone = TimeZoneInfo.FindSystemTimeZoneById(_savedProfile.TimeZone);
        var localNow = TimeZoneInfo.ConvertTime(
            DateTimeOffset.Parse(_savedProfile.CurrentTime, CultureInfo.InvariantCulture), zone);
        var today = DateOnly.FromDateTime(localNow.DateTime);
        var monday = today.AddDays(-((int)today.DayOfWeek + 6) % 7).AddDays(WeekOffset * 7);
        WeekDays = Enumerable.Range(0, 7).Select(day =>
        {
            var date = monday.AddDays(day);
            return new CalendarWeekDay(date, date.ToString("ddd", CultureInfo.CurrentCulture).ToUpperInvariant(),
                date.Day.ToString(CultureInfo.CurrentCulture), date == today);
        }).ToArray();
        WeekLabel = $"{monday:MMM d} – {monday.AddDays(6):MMM d, yyyy}";
        WeekTimeZone = _savedProfile.TimeZone;
        WeekBlocks = CalendarWeekLayout.Build(Events, monday, zone);
    }

    public void OpenWeekEvent(CalendarEvent item)
    {
        SelectedEvent = Events.FirstOrDefault(candidate => candidate.Id == item.Id);
        SelectedCalendarTabIndex = 1;
    }

    public async Task CreateWeekEventAsync(int day, int minute) => await Shell.RunAsync(async () =>
    {
        if (_savedProfile is null || day < 0 || day >= WeekDays.Count)
            throw new InvalidOperationException("Choose a day in the calendar first.");
        if (!await ConfirmDiscardAsync(EventHasChanges, "event changes")) return;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(_savedProfile.TimeZone);
        var local = WeekDays[day].Date.ToDateTime(TimeOnly.MinValue).AddMinutes(Math.Clamp(minute, 0, 1425));
        var start = LocalToUtc(local, zone, null);
        ResetEvent();
        EventStart = FormatInstant(start);
        EventEnd = FormatInstant(start.AddHours(1));
        SelectedCalendarTabIndex = 1;
    });

    public void MoveWeekEvent(CalendarEvent item, int deltaDays, int deltaMinutes, bool resize) => Shell.Run(() =>
    {
        if (_savedProfile is null) throw new InvalidOperationException("Create the calendar first.");
        var start = DateTimeOffset.Parse(item.StartAt, CultureInfo.InvariantCulture);
        var end = DateTimeOffset.Parse(item.EndAt, CultureInfo.InvariantCulture);
        DateTimeOffset nextStart;
        DateTimeOffset nextEnd;
        if (resize)
        {
            nextStart = start;
            nextEnd = end.AddMinutes(deltaMinutes);
            if (nextEnd < start.AddMinutes(15)) nextEnd = start.AddMinutes(15);
        }
        else
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(_savedProfile.TimeZone);
            var local = TimeZoneInfo.ConvertTime(start, zone);
            var minutes = Math.Clamp(local.Hour * 60 + local.Minute + deltaMinutes, 0, 1425);
            var target = DateTime.SpecifyKind(local.Date.AddDays(deltaDays).AddMinutes(minutes), DateTimeKind.Unspecified);
            nextStart = LocalToUtc(target, zone, local.Offset);
            nextEnd = nextStart + (end - start);
        }
        var saved = Store.SaveCalendarEvent(WorkspaceId, item.Id, item.ToInput() with
        {
            StartAt = FormatInstant(nextStart),
            EndAt = FormatInstant(nextEnd)
        }, expected: item);
        var editingSameEvent = _editingEventId == item.Id;
        var canMergeTimes = editingSameEvent && _editingEvent is not null &&
            MockariumJson.Serialize(_editingEvent.ToInput()) == MockariumJson.Serialize(item.ToInput()) &&
            EventStart == item.StartAt && EventEnd == item.EndAt;
        RefreshEvents();
        if (canMergeTimes)
        {
            _editingEvent = saved;
            EventStart = saved.StartAt;
            EventEnd = saved.EndAt;
            if (_savedEventForm is not null)
                _savedEventForm = _savedEventForm with { Start = saved.StartAt, End = saved.EndAt };
        }
        Shell.Notice = editingSameEvent && !canMergeTimes
            ? "Event moved. Your unsaved editor values were preserved; refresh before saving them."
            : resize ? "Event length updated." : "Event rescheduled.";
    });

    private static DateTimeOffset LocalToUtc(DateTime local, TimeZoneInfo zone, TimeSpan? preferredOffset)
    {
        if (zone.IsInvalidTime(local))
            throw new ArgumentException("That local time does not exist because the clocks change. Choose another time.");
        var offsets = zone.IsAmbiguousTime(local) ? zone.GetAmbiguousTimeOffsets(local) : [zone.GetUtcOffset(local)];
        var offset = preferredOffset is { } preferred && offsets.Contains(preferred) ? preferred : offsets.Max();
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    private static string FormatInstant(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    partial void OnSelectedPersonChanged(CalendarPerson? value)
    {
        if (value is null || _loading) return;
        if (PersonHasChanges || _changingPerson)
        {
            _loading = true;
            try { SelectedPerson = People.FirstOrDefault(person => person.Id == _editingPersonId); }
            finally { _loading = false; }
            if (!_changingPerson) _ = SelectPersonAsync(value);
            return;
        }
        ApplyPerson(value);
    }

    private async Task SelectPersonAsync(CalendarPerson person)
    {
        _changingPerson = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(PersonHasChanges, "person changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                var selected = People.FirstOrDefault(item => item.Id == person.Id)
                    ?? throw new InvalidOperationException("The selected person is no longer available.");
                _loading = true;
                try { SelectedPerson = selected; }
                finally { _loading = false; }
                ApplyPerson(selected);
            });
        }
        finally { _changingPerson = false; }
    }

    private void ApplyPerson(CalendarPerson value)
    {
        _editingPersonId = value.Id;
        PersonName = value.Name;
        PersonEmail = value.Email;
        PersonCompany = value.Company;
        PersonTimeZone = value.TimeZone;
        PersonWorkStart = value.WorkStart;
        PersonWorkEnd = value.WorkEnd;
        _savedPersonForm = CurrentPersonForm();
    }

    partial void OnSelectedEventChanged(CalendarEvent? value)
    {
        if (value is null || _loading) return;
        if (EventHasChanges || _changingEvent)
        {
            _loading = true;
            try { SelectedEvent = Events.FirstOrDefault(item => item.Id == _editingEventId); }
            finally { _loading = false; }
            if (!_changingEvent) _ = SelectEventAsync(value);
            return;
        }
        ApplyEvent(value);
    }

    private async Task SelectEventAsync(CalendarEvent calendarEvent)
    {
        _changingEvent = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(EventHasChanges, "event changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                var selected = Events.FirstOrDefault(item => item.Id == calendarEvent.Id)
                    ?? throw new InvalidOperationException("The selected event is no longer available.");
                _loading = true;
                try { SelectedEvent = selected; }
                finally { _loading = false; }
                ApplyEvent(selected);
            });
        }
        finally { _changingEvent = false; }
    }

    private void ApplyEvent(CalendarEvent value)
    {
        _editingEventId = value.Id;
        _editingEvent = value;
        EventTitle = value.Title;
        EventDescription = value.Description;
        EventLocation = value.Location;
        EventStart = value.StartAt;
        EventEnd = value.EndAt;
        EventOrganizer = value.OrganizerEmail;
        EventAttendees = string.Join(Environment.NewLine, value.Attendees.Select(attendee => $"{attendee.Email}, {attendee.Response}"));
        EventStatus = value.Status;
        _savedEventForm = CurrentEventForm();
    }

    [RelayCommand]
    private Task RefreshAsync() => RefreshDataAsync();

    [RelayCommand]
    private void SaveProfile() => Shell.Run(() =>
    {
        var saved = Store.SaveCalendarProfile(WorkspaceId,
            new CalendarProfile(OwnerName, OwnerEmail, OwnerTimeZone, WorkStart, WorkEnd, SimulatedTime));
        ApplyProfile(saved);
        RefreshEvents();
        Shell.Notice = $"Calendar setup saved for {saved.Name}.";
    });

    [RelayCommand]
    private async Task NewPersonAsync() => await Shell.RunAsync(async () =>
    {
        if (await ConfirmDiscardAsync(PersonHasChanges, "person changes")) ResetPerson();
    });

    private void ResetPerson()
    {
        _editingPersonId = null;
        SelectedPerson = null;
        PersonName = PersonEmail = PersonCompany = "";
        PersonTimeZone = string.IsNullOrEmpty(OwnerTimeZone) ? "Europe/London" : OwnerTimeZone;
        PersonWorkStart = "09:00";
        PersonWorkEnd = "17:00";
        _savedPersonForm = CurrentPersonForm();
    }

    [RelayCommand]
    private void SavePerson() => Shell.Run(() =>
    {
        var saved = Store.SaveCalendarPerson(WorkspaceId, _editingPersonId,
            new CalendarPersonInput(PersonName, PersonEmail, PersonCompany, PersonTimeZone, PersonWorkStart, PersonWorkEnd));
        RefreshPeople();
        RefreshEvents();
        _loading = true;
        try { SelectedPerson = People.FirstOrDefault(person => person.Id == saved.Id); }
        finally { _loading = false; }
        ApplyPerson(saved);
        Shell.Notice = "Person saved.";
    });

    [RelayCommand]
    private async Task DeletePersonAsync() => await Shell.RunAsync(async () =>
    {
        var id = _editingPersonId ?? throw new InvalidOperationException("Select a person first.");
        var workspaceId = WorkspaceId;
        var hasChanges = PersonHasChanges;
        if (!await Platform.ConfirmAsync("Delete person",
            $"Permanently delete this person{(hasChanges ? " and discard their unsaved changes" : "")}? This cannot be undone."))
            return;
        if (!HasWorkspace || WorkspaceId != workspaceId || _editingPersonId != id) return;
        Store.DeleteCalendarPerson(WorkspaceId, id);
        RefreshPeople();
        RefreshEvents();
        ResetPerson();
        Shell.Notice = "Person removed.";
    });

    [RelayCommand]
    private async Task NewEventAsync() => await Shell.RunAsync(async () =>
    {
        if (await ConfirmDiscardAsync(EventHasChanges, "event changes")) ResetEvent();
    });

    private void ResetEvent()
    {
        _editingEventId = null;
        _editingEvent = null;
        SelectedEvent = null;
        EventTitle = EventDescription = EventLocation = EventAttendees = "";
        var start = DateTimeOffset.TryParse(SimulatedTime, CultureInfo.InvariantCulture, DateTimeStyles.None, out var simulated)
            ? simulated : DateTimeOffset.UtcNow;
        EventStart = start.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        EventEnd = start.AddHours(1).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        EventOrganizer = OwnerEmail;
        EventStatus = "confirmed";
        _savedEventForm = CurrentEventForm();
    }

    [RelayCommand]
    private void SaveEvent() => Shell.Run(() =>
    {
        var attendees = EventAttendees.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(line =>
            {
                var parts = line.Split(',', StringSplitOptions.TrimEntries);
                if (parts.Length is < 1 or > 2 || string.IsNullOrEmpty(parts[0]))
                    throw new ArgumentException("Enter one attendee per line as email, response.");
                return new CalendarAttendee(parts[0], parts.Length == 2 ? parts[1] : "needsAction");
            }).ToArray();
        var saved = Store.SaveCalendarEvent(WorkspaceId, _editingEventId, new CalendarEventInput(
            EventTitle, EventDescription, EventLocation, EventStart, EventEnd, EventOrganizer, attendees, EventStatus),
            expected: _editingEvent);
        RefreshEvents();
        _loading = true;
        try { SelectedEvent = Events.FirstOrDefault(item => item.Id == saved.Id); }
        finally { _loading = false; }
        ApplyEvent(saved);
        Shell.Notice = "Event saved.";
    });

    [RelayCommand]
    private async Task DeleteEventAsync() => await Shell.RunAsync(async () =>
    {
        var id = _editingEventId ?? throw new InvalidOperationException("Select an event first.");
        var workspaceId = WorkspaceId;
        var hasChanges = EventHasChanges;
        if (!await Platform.ConfirmAsync("Delete event",
            $"Permanently delete this event{(hasChanges ? " and discard its unsaved changes" : "")}? This cannot be undone."))
            return;
        if (!HasWorkspace || WorkspaceId != workspaceId || _editingEventId != id) return;
        Store.DeleteCalendarEvent(WorkspaceId, id, _editingEvent);
        RefreshEvents();
        ResetEvent();
        Shell.Notice = "Event deleted.";
    });
}
