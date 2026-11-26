using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Styling;
using Microsoft.Extensions.Logging;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;
using Mockarium.ViewModels;

namespace Mockarium.Desktop;

public partial class App : Application
{
    private ILoggerFactory? _loggerFactory;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
        var day = new ResourceDictionary();
        var night = new ResourceDictionary();
        foreach (var (key, light, dark) in StudioPalette.Brushes)
        {
            day.Add(key, new SolidColorBrush(Color.Parse(light)));
            night.Add(key, new SolidColorBrush(Color.Parse(dark)));
        }
        Resources.ThemeDictionaries.Add(ThemeVariant.Light, day);
        Resources.ThemeDictionaries.Add(ThemeVariant.Dark, night);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            try
            {
                _loggerFactory = LoggerFactory.Create(builder => builder.AddDebug().SetMinimumLevel(LogLevel.Warning));
                var store = new MockariumStore(MockariumStore.DefaultDatabasePath());
                try
                {
                    var runtime = new McpRuntime(store, _loggerFactory);
                    var window = new MainWindow();
                    window.Initialize(new DesktopViewModel(store, runtime, new AvaloniaPlatformServices(window), _loggerFactory));
                    desktop.MainWindow = window;
                }
                catch
                {
                    store.Dispose();
                    throw;
                }
            }
            catch (Exception exception)
            {
                desktop.MainWindow = new Window
                {
                    Title = "Mockarium - startup error",
                    Width = 560,
                    Height = 220,
                    Content = new ScrollViewer
                    {
                        VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
                        Content = new TextBlock
                        {
                            Text = $"Mockarium could not start.\n\n{exception.Message}",
                            Margin = new Thickness(24),
                            TextWrapping = Avalonia.Media.TextWrapping.Wrap
                        }
                    }
                };
            }
            desktop.Exit += (_, _) => _loggerFactory?.Dispose();
        }
        base.OnFrameworkInitializationCompleted();
    }
}
