using Avalonia.Controls;
using Mockarium.ViewModels;

namespace Mockarium.Desktop;

public partial class MainWindow : Window
{
    private DesktopViewModel? _viewModel;
    private bool _closedCleanly;
    private bool _closing;

    public MainWindow() => InitializeComponent();

    public void Initialize(DesktopViewModel viewModel)
    {
        _viewModel = viewModel;
        DataContext = viewModel;
    }

    protected override async void OnClosing(WindowClosingEventArgs e)
    {
        if (_closedCleanly || _viewModel is null)
        {
            base.OnClosing(e);
            return;
        }
        e.Cancel = true;
        if (_closing) return;
        _closing = true;
        try
        {
            if (!await _viewModel.ConfirmCloseAsync()) return;
            IsEnabled = false;
            await _viewModel.DisposeAsync();
            _closedCleanly = true;
            Close();
        }
        catch (Exception exception)
        {
            IsEnabled = true;
            _viewModel.Error = $"Mockarium could not stop its servers: {exception.Message}";
        }
        finally
        {
            _closing = false;
        }
    }
}
