using System.Globalization;
using Mockarium.Core;

namespace Mockarium.ViewModels;

public sealed record CalendarWeekDay(DateOnly Date, string Weekday, string DayNumber, bool IsToday);

public sealed record CalendarWeekBlock(
    CalendarEvent Event, int DayIndex, double StartMinute, double EndMinute,
    int Lane, int LaneCount, string TimeLabel, bool HasConflict)
{
    public bool IsAgentChange => Event.UpdatedBy == "agent";
}

internal static class CalendarWeekLayout
{
    private sealed record Segment(CalendarEvent Event, int Day, double Start, double End, string TimeLabel, bool Conflict);

    public static IReadOnlyList<CalendarWeekBlock> Build(
        IEnumerable<CalendarEvent> events, DateOnly firstDay, TimeZoneInfo zone)
    {
        var active = events.Where(item => item.Status == "confirmed").ToArray();
        var conflicts = FindConflicts(active);
        var segments = new List<Segment>();
        foreach (var item in active)
        {
            var startInstant = DateTimeOffset.Parse(item.StartAt, CultureInfo.InvariantCulture);
            var endInstant = DateTimeOffset.Parse(item.EndAt, CultureInfo.InvariantCulture);
            var localStart = TimeZoneInfo.ConvertTime(startInstant, zone).DateTime;
            var localEnd = TimeZoneInfo.ConvertTime(endInstant, zone).DateTime;
            if (localEnd <= localStart) localEnd = localStart.Add(endInstant - startInstant);
            var label = $"{localStart:HH:mm}–{localEnd:HH:mm}";
            for (var day = 0; day < 7; day++)
            {
                var midnight = firstDay.AddDays(day).ToDateTime(TimeOnly.MinValue);
                var next = midnight.AddDays(1);
                if (localStart >= next || localEnd <= midnight) continue;
                var visibleStart = localStart < midnight ? midnight : localStart;
                var visibleEnd = localEnd > next ? next : localEnd;
                segments.Add(new Segment(item, day, (visibleStart - midnight).TotalMinutes,
                    (visibleEnd - midnight).TotalMinutes, label, conflicts.Contains(item.Id)));
            }
        }

        var result = new List<CalendarWeekBlock>();
        foreach (var day in segments.GroupBy(segment => segment.Day))
        {
            var ordered = day.OrderBy(segment => segment.Start).ThenBy(segment => segment.End).ToArray();
            for (var first = 0; first < ordered.Length;)
            {
                var end = first + 1;
                var groupEnd = ordered[first].End;
                while (end < ordered.Length && ordered[end].Start < groupEnd)
                {
                    groupEnd = Math.Max(groupEnd, ordered[end].End);
                    end++;
                }
                var laneEnds = new List<double>();
                var lanes = new int[end - first];
                for (var index = first; index < end; index++)
                {
                    var lane = laneEnds.FindIndex(laneEnd => laneEnd <= ordered[index].Start);
                    if (lane < 0) { lane = laneEnds.Count; laneEnds.Add(ordered[index].End); }
                    else laneEnds[lane] = ordered[index].End;
                    lanes[index - first] = lane;
                }
                for (var index = first; index < end; index++)
                {
                    var segment = ordered[index];
                    result.Add(new CalendarWeekBlock(segment.Event, segment.Day, segment.Start, segment.End,
                        lanes[index - first], laneEnds.Count, segment.TimeLabel, segment.Conflict));
                }
                first = end;
            }
        }
        return result;
    }

    private static HashSet<string> FindConflicts(IReadOnlyList<CalendarEvent> events)
    {
        var conflicts = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < events.Count; i++)
        {
            var first = events[i];
            var firstStart = DateTimeOffset.Parse(first.StartAt, CultureInfo.InvariantCulture);
            var firstEnd = DateTimeOffset.Parse(first.EndAt, CultureInfo.InvariantCulture);
            var people = Participants(first);
            for (var j = i + 1; j < events.Count; j++)
            {
                var second = events[j];
                if (firstStart < DateTimeOffset.Parse(second.EndAt, CultureInfo.InvariantCulture) &&
                    DateTimeOffset.Parse(second.StartAt, CultureInfo.InvariantCulture) < firstEnd &&
                    Participants(second).Overlaps(people))
                {
                    conflicts.Add(first.Id);
                    conflicts.Add(second.Id);
                }
            }
        }
        return conflicts;
    }

    private static HashSet<string> Participants(CalendarEvent item) =>
        new(item.Attendees.Where(attendee => attendee.Response != "declined").Select(attendee => attendee.Email)
            .Append(item.OrganizerEmail), StringComparer.OrdinalIgnoreCase);
}
