using Avalonia.Controls;
using Avalonia;
using Avalonia.Threading;

namespace Mockarium.Desktop.Views;

public partial class OverviewView : UserControl { public OverviewView() => InitializeComponent(); }
public partial class StudioHeader : UserControl { public StudioHeader() => InitializeComponent(); }
public partial class EmailStudioView : UserControl { public EmailStudioView() => InitializeComponent(); }
public partial class DatabaseStudioView : UserControl { public DatabaseStudioView() => InitializeComponent(); }
public partial class CalendarStudioView : UserControl
{
    public CalendarStudioView()
    {
        InitializeComponent();
        AttachedToVisualTree += (_, _) => Dispatcher.UIThread.Post(() =>
            WeekScroll.Offset = new Vector(0, 7 * WeekPlannerControl.HourHeight), DispatcherPriority.Loaded);
    }
}
public partial class InspectorView : UserControl { public InspectorView() => InitializeComponent(); }
