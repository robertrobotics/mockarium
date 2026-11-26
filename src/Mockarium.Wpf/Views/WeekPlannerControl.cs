using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Mockarium.ViewModels;

namespace Mockarium.Wpf.Views;

public sealed class WeekPlannerControl : FrameworkElement
{
    public const double HourHeight = 52;
    private const double Gutter = 52;
    public static readonly DependencyProperty BlocksProperty = DependencyProperty.Register(
        nameof(Blocks), typeof(IReadOnlyList<CalendarWeekBlock>), typeof(WeekPlannerControl),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    private static readonly Brush BackgroundBrush = ColorBrush(255, 255, 255);
    private static readonly Brush WeekendBrush = ColorBrush(248, 249, 252);
    private static readonly Brush EventBrush = ColorBrush(237, 235, 255);
    private static readonly Brush AgentBrush = ColorBrush(223, 245, 235);
    private static readonly Brush ConflictBrush = ColorBrush(255, 240, 215);
    private static readonly Brush InkBrush = ColorBrush(40, 52, 85);
    private static readonly Brush MutedBrush = ColorBrush(115, 128, 151);
    private static readonly Brush AccentBrush = ColorBrush(116, 105, 223);
    private static readonly Brush AgentAccentBrush = ColorBrush(49, 155, 115);
    private static readonly Brush ConflictAccentBrush = ColorBrush(210, 139, 46);
    private static readonly Pen GridPen = new(ColorBrush(232, 236, 243), 1);
    private static readonly Typeface Regular = new(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
    private static readonly Typeface Bold = new(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal);
    private readonly List<(CalendarWeekBlock Block, Rect Rect)> _targets = [];
    private CalendarWeekBlock? _dragged;
    private Point _origin;
    private bool _resize;
    private bool _moved;
    private bool _blank;
    private int _deltaDays;
    private int _deltaMinutes;

    public IReadOnlyList<CalendarWeekBlock>? Blocks
    {
        get => (IReadOnlyList<CalendarWeekBlock>?)GetValue(BlocksProperty);
        set => SetValue(BlocksProperty, value);
    }

    protected override void OnRender(DrawingContext context)
    {
        base.OnRender(context);
        var width = Math.Max(1, (ActualWidth - Gutter) / 7);
        context.DrawRectangle(BackgroundBrush, null, new Rect(RenderSize));
        context.DrawRectangle(WeekendBrush, null, new Rect(Gutter + 5 * width, 0, 2 * width, 24 * HourHeight));
        for (var day = 0; day <= 7; day++)
            context.DrawLine(GridPen, new Point(Gutter + day * width, 0), new Point(Gutter + day * width, 24 * HourHeight));
        for (var hour = 0; hour <= 24; hour++)
        {
            var y = hour * HourHeight;
            context.DrawLine(GridPen, new Point(Gutter, y), new Point(ActualWidth, y));
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
                if (_resize) rect.Height = Math.Max(22, rect.Height + _deltaMinutes / 60d * HourHeight);
                else rect.Offset(_deltaDays * width, _deltaMinutes / 60d * HourHeight);
            }
            var fill = block.HasConflict ? ConflictBrush : block.IsAgentChange ? AgentBrush : EventBrush;
            var accent = block.HasConflict ? ConflictAccentBrush : block.IsAgentChange ? AgentAccentBrush : AccentBrush;
            context.DrawRoundedRectangle(fill, null, rect, 6, 6);
            context.DrawRoundedRectangle(accent, null,
                new Rect(rect.X, rect.Y + 4, 3, Math.Max(1, rect.Height - 8)), 2, 2);
            context.PushClip(new RectangleGeometry(rect));
            DrawText(context, block.Event.Title, new Point(rect.X + 8, rect.Y + 4), 11, InkBrush, Bold, rect.Width - 12);
            if (rect.Height >= 42)
                DrawText(context, block.TimeLabel, new Point(rect.X + 8, rect.Y + 20), 10, MutedBrush, Regular, rect.Width - 12);
            if (rect.Height >= 58 && block.HasConflict)
                DrawText(context, "Conflict", new Point(rect.X + 8, rect.Y + 34), 10, ConflictAccentBrush, Bold, rect.Width - 12);
            context.Pop();
        }
    }

    private void DrawText(DrawingContext context, string text, Point origin, double size,
        Brush brush, Typeface typeface, double width)
    {
        if (width <= 0) return;
        var formatted = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
            typeface, size, brush, VisualTreeHelper.GetDpi(this).PixelsPerDip)
        {
            MaxTextWidth = width,
            MaxLineCount = 1,
            Trimming = TextTrimming.CharacterEllipsis
        };
        context.DrawText(formatted, origin);
    }

    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonDown(e);
        if (DataContext is not CalendarStudioViewModel) return;
        _origin = e.GetPosition(this);
        if (_origin.X < Gutter || _origin.X >= ActualWidth || _origin.Y < 0 || _origin.Y >= 24 * HourHeight) return;
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
        CaptureMouse();
        e.Handled = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var point = e.GetPosition(this);
        if (!IsMouseCaptured)
        {
            var target = _targets.LastOrDefault(item => item.Rect.Contains(point));
            Cursor = target.Block is null ? Cursors.Arrow :
                point.Y >= target.Rect.Bottom - 8 ? Cursors.SizeNS : Cursors.Hand;
            ToolTip = target.Block is null ? null : $"{target.Block.Event.Title} · {target.Block.TimeLabel}";
            return;
        }
        var dx = point.X - _origin.X;
        var dy = point.Y - _origin.Y;
        _moved |= Math.Abs(dx) > 4 || Math.Abs(dy) > 4;
        if (_dragged is not null && _moved)
        {
            var dayWidth = Math.Max(1, (ActualWidth - Gutter) / 7);
            _deltaDays = _resize ? 0 : Math.Clamp((int)Math.Round(dx / dayWidth), -_dragged.DayIndex, 6 - _dragged.DayIndex);
            _deltaMinutes = (int)Math.Round(dy / HourHeight * 4) * 15;
            InvalidateVisual();
        }
        e.Handled = true;
    }

    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonUp(e);
        if (!IsMouseCaptured || DataContext is not CalendarStudioViewModel model) return;
        var dragged = _dragged;
        var moved = _moved;
        var blank = _blank;
        var days = _deltaDays;
        var minutes = _deltaMinutes;
        var resize = _resize;
        var origin = _origin;
        ReleaseMouseCapture();
        ResetPointer();
        if (dragged is not null)
        {
            if (moved && (days != 0 || minutes != 0)) model.MoveWeekEvent(dragged.Event, days, minutes, resize);
            else if (!moved) model.OpenWeekEvent(dragged.Event);
        }
        else if (blank && !moved)
        {
            var width = Math.Max(1, (ActualWidth - Gutter) / 7);
            var day = Math.Clamp((int)((origin.X - Gutter) / width), 0, 6);
            var minute = Math.Clamp((int)Math.Round(origin.Y / HourHeight * 4) * 15, 0, 1425);
            _ = model.CreateWeekEventAsync(day, minute);
        }
        e.Handled = true;
    }

    protected override void OnLostMouseCapture(MouseEventArgs e)
    {
        base.OnLostMouseCapture(e);
        ResetPointer();
    }

    private void ResetPointer()
    {
        _dragged = null;
        _blank = _moved = false;
        _deltaDays = _deltaMinutes = 0;
        InvalidateVisual();
    }

    private static Brush ColorBrush(byte red, byte green, byte blue)
    {
        var brush = new SolidColorBrush(Color.FromRgb(red, green, blue));
        brush.Freeze();
        return brush;
    }
}
