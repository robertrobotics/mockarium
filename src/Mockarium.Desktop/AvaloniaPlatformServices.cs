using Avalonia;
using Avalonia.Controls;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Mockarium.ViewModels;

namespace Mockarium.Desktop;

public sealed class AvaloniaPlatformServices(Window window) : IPlatformServices
{
    public void Post(Action action) => Dispatcher.UIThread.Post(action);

    public async Task<bool> ConfirmAsync(string title, string message)
    {
        var dialog = new Window
        {
            Title = title,
            Width = 470,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner
        };
        var cancel = new Button { Content = "Cancel", Margin = new Thickness(0, 0, 8, 0) };
        var confirm = new Button { Content = "Continue" };
        confirm.Classes.Add("primary");
        cancel.Click += (_, _) => dialog.Close(false);
        confirm.Click += (_, _) => dialog.Close(true);
        dialog.Content = new StackPanel
        {
            Margin = new Thickness(24),
            Children =
            {
                new TextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap },
                new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Right,
                    Margin = new Thickness(0, 20, 0, 0),
                    Children = { cancel, confirm }
                }
            }
        };
        return await dialog.ShowDialog<bool>(window);
    }

    public async Task CopyTextAsync(string text)
    {
        var clipboard = TopLevel.GetTopLevel(window)?.Clipboard
            ?? throw new InvalidOperationException("The system clipboard is unavailable.");
        await clipboard.SetTextAsync(text);
    }

    public async Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync)
    {
        var file = await window.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Export execution history",
            SuggestedFileName = suggestedName,
            DefaultExtension = extension,
            FileTypeChoices = [new FilePickerFileType(description) { Patterns = [$"*.{extension}"] }]
        });
        if (file is null) return false;
        await using var stream = await file.OpenWriteAsync();
        if (stream.CanSeek) stream.SetLength(0);
        await writeAsync(stream);
        return true;
    }
}
