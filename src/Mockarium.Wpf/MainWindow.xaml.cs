using System.ComponentModel;
using System.Windows;
using Mockarium.ViewModels;

namespace Mockarium.Wpf;

public partial class MainWindow : Window
{
    private DesktopViewModel? _viewModel;
    private bool _closedCleanly;
    private bool _closing;

    public MainWindow() => InitializeComponent();

    public void Initialize(DesktopViewModel viewModel)
    {
        _viewModel = viewModel;
        ((App)Application.Current).ApplyAppearance(viewModel.IsNightMode);
        viewModel.PropertyChanged += OnPreferenceChanged;
        DataContext = viewModel;
    }

    private void OnPreferenceChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(DesktopViewModel.IsNightMode))
            ((App)Application.Current).ApplyAppearance(_viewModel!.IsNightMode);
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_viewModel is not null) _viewModel.PropertyChanged -= OnPreferenceChanged;
        base.OnClosed(e);
    }

    protected override async void OnClosing(CancelEventArgs e)
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
            MessageBox.Show(this, $"Mockarium could not stop its servers.\n\n{exception.Message}",
                "Shutdown failed", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _closing = false;
        }
    }
}
