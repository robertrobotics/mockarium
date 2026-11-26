using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Mockarium.ViewModels;

namespace Mockarium.Desktop.Views;

public sealed class WeekPlannerControl : Control
{
    public const double HourHeight = 52;
    private const double Gutter = 52;
    public static readonly StyledProperty<IReadOnlyList<CalendarWeekBlock>?> BlocksProperty =
        AvaloniaProperty.Register<WeekPlannerControl, IReadOnlyList<CalendarWeekBlock>?>(nameof(Blocks));

    private static readonly IBrush BackgroundBrush = Brush.Parse("#FFFFFF");
    private static readonly IBrush WeekendBrush = Brush.Parse("#F8F9FC");
    private static readonly IBrush EventBrush = Brush.Parse("#EDEBFF");
    private static readonly IBrush AgentBrush = Brush.Parse("#DFF5EB");
    private static readonly IBrush ConflictBrush = Brush.Parse("#FFF0D7");
    private static readonly IBrush InkBrush = Brush.Parse("#283455");
    private static readonly IBrush MutedBrush = Brush.Parse("#738097");
    private static readonly IBrush AccentBrush = Brush.Parse("#7469DF");
    private static readonly IBrush AgentAccentBrush = Brush.Parse("#319B73");
    private static readonly IBrush ConflictAccentBrush = Brush.Parse("#D28B2E");
    private static readonly Pen GridPen = new(Brush.Parse("#E8ECF3"), 1);
    private static readonly Typeface Regular = new("avares://Avalonia.Fonts.Inter/Assets#Inter");
    private static readonly Typeface Bold = new("avares://Avalonia.Fonts.Inter/Assets#Inter", weight: FontWeight.SemiBold);
    private readonly List<(CalendarWeekBlock Block, Rect Rect)> _targets = [];
    private CalendarWeekBlock? _dragged;
    private Point _origin;
    private bool _resize;
    private bool _moved;
    private bool _blank;
    private int _deltaDays;
    private int _deltaMinutes;

    static WeekPlannerControl() => AffectsRender<WeekPlannerControl>(BlocksProperty);

    public IReadOnlyList<CalendarWeekBlock>? Blocks
    {
        get => GetValue(BlocksProperty);
        set => SetValue(BlocksProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var width = Math.Max(1, (Bounds.Width - Gutter) / 7);
        context.DrawRectangle(BackgroundBrush, null, new Rect(Bounds.Size));
        context.DrawRectangle(WeekendBrush, null, new Rect(Gutter + 5 * width, 0, 2 * width, 24 * HourHeight));
        for (var day = 0; day <= 7; day++)
            context.DrawLine(GridPen, new Point(Gutter + day * width, 0), new Point(Gutter + day * width, 24 * HourHeight));
        for (var hour = 0; hour <= 24; hour++)
        {
            var y = hour * HourHeight;
            context.DrawLine(GridPen, new Point(Gutter, y), new Point(Bounds.Width, y));
            if (hour < 24) DrawText(context, $"{hour:00}:00", new Point(5, y + 4), 10, MutedBrush, Regular, Gutter - 8);
        }

        _targets.Clear();
        foreach (var block in Blocks ?? [])
        {
            var laneWidth = (width - 6) / block.LaneCount;
            var rect = new Rect(Gutter + block.DayIndex * width + block.Lane * laneWidth + 3,
                block.StartMinute / 60 * HourHeight + 2, Math.Max(1, laneWidth - 3),
                Math.Max(22, (block.EndMinute - block.StartMinute) / 60 * HourHeight - 4));
            _targets.Add((block, rect));
            if (_moved && _dragged?.Event.Id == block.Event.Id)
            {
                rect = _resize
                    ? new Rect(rect.X, rect.Y, rect.Width, Math.Max(22, rect.Height + _deltaMinutes / 60d * HourHeight))
                    : rect.Translate(new Vector(_deltaDays * width, _deltaMinutes / 60d * HourHeight));
            }
            var fill = block.HasConflict ? ConflictBrush : block.IsAgentChange ? AgentBrush : EventBrush;
            var accent = block.HasConflict ? ConflictAccentBrush : block.IsAgentChange ? AgentAccentBrush : AccentBrush;
            context.DrawRectangle(fill, null, rect, 6, 6);
            context.DrawRectangle(accent, null, new Rect(rect.X, rect.Y + 4, 3, Math.Max(1, rect.Height - 8)), 2, 2);
            using (context.PushClip(rect))
            {
                DrawText(context, block.Event.Title, new Point(rect.X + 8, rect.Y + 4), 11, InkBrush, Bold, rect.Width - 12);
                if (rect.Height >= 42)
                    DrawText(context, block.TimeLabel, new Point(rect.X + 8, rect.Y + 20), 10, MutedBrush, Regular, rect.Width - 12);
                if (rect.Height >= 58 && block.HasConflict)
                    DrawText(context, "Conflict", new Point(rect.X + 8, rect.Y + 34), 10, ConflictAccentBrush, Bold, rect.Width - 12);
            }
        }
    }

    private static void DrawText(DrawingContext context, string text, Point origin, double size,
        IBrush brush, Typeface typeface, double width)
    {
        if (width <= 0) return;
        var formatted = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, size, brush)
        {
            MaxTextWidth = width,
            MaxLineCount = 1,
            Trimming = TextTrimming.CharacterEllipsis
        };
        context.DrawText(formatted, origin);
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || DataContext is not CalendarStudioViewModel) return;
        _origin = e.GetPosition(this);
        if (_origin.X < Gutter || _origin.X >= Bounds.Width || _origin.Y < 0 || _origin.Y >= 24 * HourHeight) return;
        _dragged = null;
        for (var i = _targets.Count - 1; i >= 0; i--)
        {
            if (!_targets[i].Rect.Contains(_origin)) continue;
            _dragged = _targets[i].Block;
            _resize = _origin.Y >= _targets[i].Rect.Bottom - 8;
            break;
        }
        _blank = _dragged is null;
        _moved = false;
        _deltaDays = _deltaMinutes = 0;
        e.Pointer.Capture(this);
        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        var point = e.GetPosition(this);
        if (e.Pointer.Captured != this)
        {
            var target = _targets.LastOrDefault(item => item.Rect.Contains(point));
            Cursor = target.Block is null ? Cursor.Default :
                new Cursor(point.Y >= target.Rect.Bottom - 8 ? StandardCursorType.SizeNorthSouth : StandardCursorType.Hand);
            ToolTip.SetTip(this, target.Block is null ? null : $"{target.Block.Event.Title} · {target.Block.TimeLabel}");
            return;
        }
        var dx = point.X - _origin.X;
        var dy = point.Y - _origin.Y;
        _moved |= Math.Abs(dx) > 4 || Math.Abs(dy) > 4;
        if (_dragged is not null && _moved)
        {
            var dayWidth = Math.Max(1, (Bounds.Width - Gutter) / 7);
            _deltaDays = _resize ? 0 : Math.Clamp((int)Math.Round(dx / dayWidth), -_dragged.DayIndex, 6 - _dragged.DayIndex);
            _deltaMinutes = (int)Math.Round(dy / HourHeight * 4) * 15;
            InvalidateVisual();
        }
        e.Handled = true;
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (e.Pointer.Captured != this || DataContext is not CalendarStudioViewModel model) return;
        var dragged = _dragged;
        var moved = _moved;
        var blank = _blank;
        var days = _deltaDays;
        var minutes = _deltaMinutes;
        var resize = _resize;
        var origin = _origin;
        e.Pointer.Capture(null);
        ResetPointer();
        if (dragged is not null)
        {
            if (moved && (days != 0 || minutes != 0)) model.MoveWeekEvent(dragged.Event, days, minutes, resize);
            else if (!moved) model.OpenWeekEvent(dragged.Event);
        }
        else if (blank && !moved)
        {
            var width = Math.Max(1, (Bounds.Width - Gutter) / 7);
            var day = Math.Clamp((int)((origin.X - Gutter) / width), 0, 6);
            var minute = Math.Clamp((int)Math.Round(origin.Y / HourHeight * 4) * 15, 0, 1425);
            _ = model.CreateWeekEventAsync(day, minute);
        }
        e.Handled = true;
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        ResetPointer();
    }

    private void ResetPointer()
    {
        _dragged = null;
        _blank = _moved = false;
        _deltaDays = _deltaMinutes = 0;
        InvalidateVisual();
    }
}
