namespace Mockarium.ViewModels;

public interface IPlatformServices
{
    void Post(Action action);
    Task<bool> ConfirmAsync(string title, string message);
    Task CopyTextAsync(string text);
    Task<bool> SaveFileAsync(string suggestedName, string extension, string description, Func<Stream, Task> writeAsync);
}
