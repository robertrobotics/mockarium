using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Data;
using Microsoft.Win32;
using Mockarium.ViewModels;

namespace Mockarium.Wpf;

public sealed class WpfPlatformServices(Window window) : IPlatformServices
{
    public void Post(Action action) => window.Dispatcher.BeginInvoke(action);

    public Task<bool> ConfirmAsync(string title, string message) =>
        Task.FromResult(MessageBox.Show(window, message, title, MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes);

    public Task CopyTextAsync(string text)
    {
        Clipboard.SetText(text);
        return Task.CompletedTask;
    }

    public async Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync)
    {
        var dialog = new SaveFileDialog
        {
            FileName = suggestedName,
            Filter = $"{description} (*.{extension})|*.{extension}",
            DefaultExt = $".{extension}"
        };
        if (dialog.ShowDialog(window) != true) return false;
        await using var stream = new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write, FileShare.None, 4096, useAsync: true);
        await writeAsync(stream);
        return true;
    }
}

public sealed class InverseBooleanToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
