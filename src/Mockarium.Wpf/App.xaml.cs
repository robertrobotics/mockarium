using System.Windows;
using System.Windows.Media;
using Microsoft.Extensions.Logging;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;
using Mockarium.ViewModels;

namespace Mockarium.Wpf;

public partial class App : Application
{
    private ILoggerFactory? _loggerFactory;
    private ResourceDictionary? _palette;

    internal void ApplyAppearance(bool night)
    {
        // WPF still marks switching its Fluent controls at runtime as experimental in .NET 11.
#pragma warning disable WPF0001
        ThemeMode = night ? ThemeMode.Dark : ThemeMode.Light;
#pragma warning restore WPF0001
        var palette = new ResourceDictionary();
        foreach (var (key, light, dark) in StudioPalette.Brushes)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(night ? dark : light));
            brush.Freeze();
            palette.Add(key, brush);
        }
        Resources.MergedDictionaries.Add(palette);
        if (_palette is not null) Resources.MergedDictionaries.Remove(_palette);
        _palette = palette;
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            _loggerFactory = LoggerFactory.Create(builder => builder.AddDebug().SetMinimumLevel(LogLevel.Warning));
            var store = new MockariumStore(MockariumStore.DefaultDatabasePath());
            try
            {
                var runtime = new McpRuntime(store, _loggerFactory);
                var window = new MainWindow();
                var services = new WpfPlatformServices(window);
                window.Initialize(new DesktopViewModel(store, runtime, services, _loggerFactory));
                MainWindow = window;
                window.Show();
            }
            catch
            {
                store.Dispose();
                throw;
            }
        }
        catch (Exception exception)
        {
            MessageBox.Show($"Mockarium could not start.\n\n{exception.Message}", "Mockarium", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _loggerFactory?.Dispose();
        base.OnExit(e);
    }
}
