using System.Windows.Controls;

namespace Mockarium.Wpf.Views;

public partial class OverviewView : UserControl { public OverviewView() => InitializeComponent(); }
public partial class StudioHeader : UserControl { public StudioHeader() => InitializeComponent(); }
public partial class EmailStudioView : UserControl { public EmailStudioView() => InitializeComponent(); }
public partial class DatabaseStudioView : UserControl { public DatabaseStudioView() => InitializeComponent(); }
public partial class CalendarStudioView : UserControl
{
    public CalendarStudioView()
    {
        InitializeComponent();
        Loaded += (_, _) => WeekScroll.ScrollToVerticalOffset(7 * WeekPlannerControl.HourHeight);
    }
}
public partial class InspectorView : UserControl { public InspectorView() => InitializeComponent(); }
