using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed partial class EmailStudioViewModel : StudioViewModel
{
    private bool _loading;
    private string? _editingEmailId;
    private string? _editingContactEmail;
    private EmailProfile? _savedProfile;
    private MessageForm? _savedMessageForm;
    private EmailContact? _savedContactForm;
    private bool _changingMessage;
    private bool _changingContact;

    private sealed record MessageForm(
        string Folder, string FromName, string FromEmail, string ToEmail, string Subject,
        string Body, string SentAt, string ParentEmailId);

    [ObservableProperty] private string mailboxName = "";
    [ObservableProperty] private string mailboxEmail = "";
    [ObservableProperty] private string newFolderName = "";
    [ObservableProperty] private string? selectedFolder;
    [ObservableProperty] private string messageSearch = "";
    [ObservableProperty] private EmailMessage? selectedMessage;
    [ObservableProperty] private string editFolder = "Inbox";
    [ObservableProperty] private string fromName = "";
    [ObservableProperty] private string fromEmail = "";
    [ObservableProperty] private string toEmail = "";
    [ObservableProperty] private string subject = "";
    [ObservableProperty] private string body = "";
    [ObservableProperty] private string sentAt = "";
    [ObservableProperty] private string parentEmailId = "";
    [ObservableProperty] private EmailContact? selectedContact;
    [ObservableProperty] private string contactName = "";
    [ObservableProperty] private string contactEmail = "";
    [ObservableProperty] private string contactCompany = "";

    public EmailStudioViewModel(DesktopViewModel shell, MockariumStore store, McpRuntime runtime, IPlatformServices platform)
        : base(shell, store, runtime, platform, "email", "Email Studio",
            "A realistic mailbox for safe, stateful agent conversations.", "✉") { }

    public ObservableCollection<string> Folders { get; } = [];
    public ObservableCollection<EmailMessage> Messages { get; } = [];
    public ObservableCollection<EmailContact> Contacts { get; } = [];
    private bool MessageHasChanges => _savedMessageForm is not null && _savedMessageForm != CurrentMessageForm();
    private bool ContactHasChanges => _savedContactForm is not null && _savedContactForm != CurrentContactForm();
    internal override bool HasUnsavedChanges => IsConfigured &&
        (_savedProfile != new EmailProfile(MailboxName, MailboxEmail) ||
         MessageHasChanges || ContactHasChanges ||
         !string.IsNullOrEmpty(NewFolderName));

    private MessageForm CurrentMessageForm() =>
        new(EditFolder, FromName, FromEmail, ToEmail, Subject, Body, SentAt, ParentEmailId);
    private EmailContact CurrentContactForm() => new(ContactName, ContactEmail, ContactCompany);

    protected override void LoadData()
    {
        _loading = true;
        try
        {
            EditFolder = "";
            Folders.Clear();
            Messages.Clear();
            Contacts.Clear();
            SelectedMessage = null;
            SelectedContact = null;
            _editingEmailId = null;
            _editingContactEmail = null;
            _savedProfile = null;
            _savedMessageForm = null;
            _savedContactForm = null;
            NewFolderName = "";
            MessageSearch = "";
            if (!HasWorkspace || !IsConfigured)
            {
                MailboxName = MailboxEmail = "";
                SelectedFolder = null;
                return;
            }
            var profile = Store.GetEmailProfile(WorkspaceId);
            _savedProfile = profile;
            MailboxName = profile.Name;
            MailboxEmail = profile.Email;
            foreach (var folder in Store.ListEmailFolders(WorkspaceId)) Folders.Add(folder);
            SelectedFolder = Folders.FirstOrDefault();
            foreach (var contact in Store.ListEmailContacts(WorkspaceId)) Contacts.Add(contact);
        }
        finally
        {
            _loading = false;
        }
        RefreshMessages();
        ResetMessage();
        ResetContact();
    }

    protected override void ResetData() => Store.ResetEmail(WorkspaceId);

    internal override void OnAgentExecution(ExecutionEvent entry)
    {
        if (entry.ToolName is not ("send_email" or "reply_to_email" or "create_draft")) return;
        var selectedId = SelectedMessage?.Id;
        _loading = true;
        try
        {
            RefreshMessages();
            SelectedMessage = Messages.FirstOrDefault(message => message.Id == selectedId);
        }
        finally
        {
            _loading = false;
        }
    }

    partial void OnSelectedFolderChanged(string? value)
    {
        if (!_loading && HasWorkspace && IsConfigured)
            Shell.Run(RefreshMessages);
    }

    partial void OnMessageSearchChanged(string value)
    {
        if (_loading || !IsConfigured) return;
        Shell.Run(() =>
        {
            _loading = true;
            try
            {
                RefreshMessages();
                SelectedMessage = Messages.FirstOrDefault(message => message.Id == _editingEmailId);
            }
            finally { _loading = false; }
        });
    }

    partial void OnSelectedMessageChanged(EmailMessage? value)
    {
        if (value is null || _loading) return;
        if (MessageHasChanges || _changingMessage)
        {
            _loading = true;
            try { SelectedMessage = Messages.FirstOrDefault(message => message.Id == _editingEmailId); }
            finally { _loading = false; }
            if (!_changingMessage) _ = SelectMessageAsync(value);
            return;
        }
        ApplyMessage(value);
    }

    private async Task SelectMessageAsync(EmailMessage message)
    {
        _changingMessage = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(MessageHasChanges, "message changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                var selected = Messages.FirstOrDefault(item => item.Id == message.Id)
                    ?? throw new InvalidOperationException("The selected message is no longer available.");
                _loading = true;
                try { SelectedMessage = selected; }
                finally { _loading = false; }
                ApplyMessage(selected);
            });
        }
        finally { _changingMessage = false; }
    }

    private void ApplyMessage(EmailMessage value)
    {
        _editingEmailId = value.Id;
        EditFolder = value.Folder;
        FromName = value.FromName;
        FromEmail = value.FromEmail;
        ToEmail = value.ToEmail;
        Subject = value.Subject;
        Body = value.Body;
        SentAt = value.SentAt;
        ParentEmailId = value.ParentEmailId ?? "";
        _savedMessageForm = CurrentMessageForm();
    }

    partial void OnSelectedContactChanged(EmailContact? value)
    {
        if (value is null || _loading) return;
        if (ContactHasChanges || _changingContact)
        {
            _loading = true;
            try { SelectedContact = Contacts.FirstOrDefault(contact => contact.Email == _editingContactEmail); }
            finally { _loading = false; }
            if (!_changingContact) _ = SelectContactAsync(value);
            return;
        }
        ApplyContact(value);
    }

    private async Task SelectContactAsync(EmailContact contact)
    {
        _changingContact = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(ContactHasChanges, "contact changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                var selected = Contacts.FirstOrDefault(item => item.Email == contact.Email)
                    ?? throw new InvalidOperationException("The selected contact is no longer available.");
                _loading = true;
                try { SelectedContact = selected; }
                finally { _loading = false; }
                ApplyContact(selected);
            });
        }
        finally { _changingContact = false; }
    }

    private void ApplyContact(EmailContact value)
    {
        _editingContactEmail = value.Email;
        ContactName = value.Name;
        ContactEmail = value.Email;
        ContactCompany = value.Company;
        _savedContactForm = CurrentContactForm();
    }

    [RelayCommand]
    private Task RefreshAsync() => RefreshDataAsync();

    private void RefreshMessages()
    {
        Messages.Clear();
        if (!HasWorkspace || !IsConfigured) return;
        foreach (var email in Store.SearchEmails(WorkspaceId, MessageSearch.Trim(), SelectedFolder)) Messages.Add(email);
    }

    [RelayCommand]
    private void SaveProfile() => Shell.Run(() =>
    {
        var saved = Store.SaveEmailProfile(WorkspaceId, new EmailProfile(MailboxName, MailboxEmail));
        MailboxName = saved.Name;
        MailboxEmail = saved.Email;
        _savedProfile = saved;
        Shell.Notice = "Mailbox identity saved.";
    });

    [RelayCommand]
    private void AddFolder() => Shell.Run(() =>
    {
        var folders = Store.AddEmailFolder(WorkspaceId, NewFolderName);
        var editFolder = EditFolder;
        EditFolder = "";
        Folders.Clear();
        foreach (var folder in folders) Folders.Add(folder);
        EditFolder = editFolder;
        SelectedFolder = NewFolderName.Trim();
        NewFolderName = "";
        Shell.Notice = "Folder added.";
    });

    [RelayCommand]
    private void DeleteFolder() => Shell.Run(() =>
    {
        var folder = SelectedFolder ?? throw new InvalidOperationException("Choose a folder first.");
        var folders = Store.DeleteEmailFolder(WorkspaceId, folder);
        var editFolder = EditFolder;
        EditFolder = "";
        Folders.Clear();
        foreach (var item in folders) Folders.Add(item);
        SelectedFolder = Folders.FirstOrDefault();
        EditFolder = editFolder == folder ? SelectedFolder ?? "Inbox" : editFolder;
        Shell.Notice = "Folder removed.";
    });

    [RelayCommand]
    private async Task NewMessageAsync() => await Shell.RunAsync(async () =>
    {
        if (await ConfirmDiscardAsync(MessageHasChanges, "message changes")) ResetMessage();
    });

    private void ResetMessage()
    {
        _editingEmailId = null;
        SelectedMessage = null;
        EditFolder = SelectedFolder ?? "Inbox";
        FromName = MailboxName;
        FromEmail = MailboxEmail;
        ToEmail = "";
        Subject = "";
        Body = "";
        SentAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        ParentEmailId = "";
        _savedMessageForm = CurrentMessageForm();
    }

    [RelayCommand]
    private void SaveMessage() => Shell.Run(() =>
    {
        var saved = Store.SaveEmail(WorkspaceId, _editingEmailId, new EmailMessageInput(
            EditFolder, FromName, FromEmail, ToEmail, Subject, Body, SentAt,
            string.IsNullOrWhiteSpace(ParentEmailId) ? null : ParentEmailId.Trim()));
        SelectedFolder = saved.Folder;
        RefreshMessages();
        _loading = true;
        try { SelectedMessage = Messages.FirstOrDefault(email => email.Id == saved.Id); }
        finally { _loading = false; }
        ApplyMessage(saved);
        Shell.Notice = "Message saved.";
    });

    [RelayCommand]
    private async Task DeleteMessageAsync() => await Shell.RunAsync(async () =>
    {
        var id = _editingEmailId ?? throw new InvalidOperationException("Select a message first.");
        var workspaceId = WorkspaceId;
        var hasChanges = MessageHasChanges;
        if (!await Platform.ConfirmAsync("Delete message",
            $"Permanently delete this message{(hasChanges ? " and discard its unsaved changes" : "")}? This cannot be undone."))
            return;
        if (!HasWorkspace || WorkspaceId != workspaceId || _editingEmailId != id) return;
        Store.DeleteEmail(WorkspaceId, id);
        RefreshMessages();
        ResetMessage();
        Shell.Notice = "Message deleted.";
    });

    [RelayCommand]
    private async Task NewContactAsync() => await Shell.RunAsync(async () =>
    {
        if (await ConfirmDiscardAsync(ContactHasChanges, "contact changes")) ResetContact();
    });

    private void ResetContact()
    {
        _editingContactEmail = null;
        SelectedContact = null;
        ContactName = ContactEmail = ContactCompany = "";
        _savedContactForm = CurrentContactForm();
    }

    [RelayCommand]
    private void SaveContact() => Shell.Run(() =>
    {
        var contacts = Store.SaveEmailContact(WorkspaceId, _editingContactEmail,
            new EmailContact(ContactName, ContactEmail, ContactCompany));
        Contacts.Clear();
        foreach (var contact in contacts) Contacts.Add(contact);
        var saved = Contacts.First(contact => string.Equals(contact.Email, ContactEmail.Trim(), StringComparison.OrdinalIgnoreCase));
        _loading = true;
        try { SelectedContact = saved; }
        finally { _loading = false; }
        ApplyContact(saved);
        Shell.Notice = "Contact saved.";
    });

    [RelayCommand]
    private async Task DeleteContactAsync() => await Shell.RunAsync(async () =>
    {
        var email = _editingContactEmail ?? throw new InvalidOperationException("Select a contact first.");
        var workspaceId = WorkspaceId;
        var hasChanges = ContactHasChanges;
        if (!await Platform.ConfirmAsync("Delete contact",
            $"Permanently delete this contact{(hasChanges ? " and discard its unsaved changes" : "")}? This cannot be undone."))
            return;
        if (!HasWorkspace || WorkspaceId != workspaceId || _editingContactEmail != email) return;
        var contacts = Store.DeleteEmailContact(WorkspaceId, email);
        Contacts.Clear();
        foreach (var contact in contacts) Contacts.Add(contact);
        ResetContact();
        Shell.Notice = "Contact deleted.";
    });

}
