using Avalonia.Controls;
using Avalonia;
using Avalonia.Styling;
using Avalonia.Threading;
using System.ComponentModel;
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
        Application.Current!.RequestedThemeVariant = viewModel.IsNightMode ? ThemeVariant.Dark : ThemeVariant.Light;
        viewModel.PropertyChanged += OnPreferenceChanged;
        DataContext = viewModel;
    }

    private void OnPreferenceChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(DesktopViewModel.IsNightMode))
            Application.Current!.RequestedThemeVariant = _viewModel!.IsNightMode ? ThemeVariant.Dark : ThemeVariant.Light;
        else if (e.PropertyName == nameof(DesktopViewModel.WorkspacePickerOpen))
            Dispatcher.UIThread.Post(() =>
            {
                if (_viewModel!.WorkspacePickerOpen) WorkspaceFilter.Focus();
                else if (_viewModel.HasWorkspace) WorkspaceSwitcher.Focus();
            }, DispatcherPriority.Loaded);
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_viewModel is not null) _viewModel.PropertyChanged -= OnPreferenceChanged;
        base.OnClosed(e);
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
