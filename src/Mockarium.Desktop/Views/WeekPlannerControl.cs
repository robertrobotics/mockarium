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

    public WeekPlannerControl() => ActualThemeVariantChanged += (_, _) => InvalidateVisual();

    private IBrush PaletteBrush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var value) && value is IBrush brush
            ? brush : throw new InvalidOperationException($"Missing planner brush: {key}");
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
        var gridPen = new Pen(PaletteBrush("BorderBrush"), 1);
        var ink = PaletteBrush("InkBrush");
        var muted = PaletteBrush("MutedBrush");
        context.DrawRectangle(PaletteBrush("SurfaceBrush"), null, new Rect(Bounds.Size));
        context.DrawRectangle(PaletteBrush("SubtleBrush"), null, new Rect(Gutter + 5 * width, 0, 2 * width, 24 * HourHeight));
        for (var day = 0; day <= 7; day++)
            context.DrawLine(gridPen, new Point(Gutter + day * width, 0), new Point(Gutter + day * width, 24 * HourHeight));
        for (var hour = 0; hour <= 24; hour++)
        {
            var y = hour * HourHeight;
            context.DrawLine(gridPen, new Point(Gutter, y), new Point(Bounds.Width, y));
            if (hour < 24) DrawText(context, $"{hour:00}:00", new Point(5, y + 4), 10, muted, Regular, Gutter - 8);
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
            var fill = PaletteBrush(block.HasConflict ? "WarmSoftBrush" : block.IsAgentChange ? "AccentSoftBrush" : "SecondarySoftBrush");
            var accent = PaletteBrush(block.HasConflict ? "WarmBrush" : block.IsAgentChange ? "AccentBrush" : "SecondaryBrush");
            context.DrawRectangle(fill, null, rect, 6, 6);
            context.DrawRectangle(accent, null, new Rect(rect.X, rect.Y + 4, 3, Math.Max(1, rect.Height - 8)), 2, 2);
            using (context.PushClip(rect))
            {
                DrawText(context, block.Event.Title, new Point(rect.X + 8, rect.Y + 4), 11, ink, Bold, rect.Width - 12);
                if (rect.Height >= 42)
                    DrawText(context, block.TimeLabel, new Point(rect.X + 8, rect.Y + 20), 10, muted, Regular, rect.Width - 12);
                if (rect.Height >= 58 && block.HasConflict)
                    DrawText(context, "Conflict", new Point(rect.X + 8, rect.Y + 34), 10, accent, Bold, rect.Width - 12);
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
