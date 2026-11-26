using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Mockarium.Core.Mcp;

internal sealed class EmailTools(ToolContext context)
{
    [McpServerTool(Name = "search_emails")]
    [Description("Search the simulated mailbox by sender, subject, or message body.")]
    public CallToolResult SearchEmails(
        [Description("Search text, at most 250 characters.")] string? query = null,
        [Description("Optional mailbox folder.")] string? folder = null,
        [Description("Maximum results, from 1 to 100.")] int? limit = null) =>
        context.Execute("search_emails", new { query, folder, limit },
            () => context.Store.SearchEmails(context.WorkspaceId, query, folder, limit ?? 20));

    [McpServerTool(Name = "get_email")]
    [Description("Retrieve one email by its identifier.")]
    public CallToolResult GetEmail(string email_id) =>
        context.Execute("get_email", new { email_id }, () =>
        {
            if (string.IsNullOrEmpty(email_id) || email_id.Length > 100)
                throw new ArgumentException("Email ID must contain between 1 and 100 characters.");
            return context.Store.GetEmail(context.WorkspaceId, email_id)
                ?? throw new InvalidOperationException($"No email was found with id \"{email_id}\".");
        });

    [McpServerTool(Name = "send_email")]
    [Description("Send a simulated email from the configured mailbox identity. The message is added to the mock Sent folder.")]
    public CallToolResult SendEmail(string to, string subject, string body) =>
        context.Execute("send_email", new { to, subject, body },
            () => context.Store.CreateOutboundEmail(context.WorkspaceId, "Sent", to, subject, body));

    [McpServerTool(Name = "reply_to_email")]
    [Description("Create a simulated reply to an existing email.")]
    public CallToolResult ReplyToEmail(string email_id, string body) =>
        context.Execute("reply_to_email", new { email_id, body }, () =>
        {
            if (string.IsNullOrEmpty(email_id) || email_id.Length > 100)
                throw new ArgumentException("Email ID must contain between 1 and 100 characters.");
            var original = context.Store.GetEmail(context.WorkspaceId, email_id)
                ?? throw new InvalidOperationException($"No email was found with id \"{email_id}\".");
            var subject = original.Subject.StartsWith("Re: ", StringComparison.Ordinal)
                ? original.Subject : $"Re: {original.Subject}";
            return context.Store.CreateOutboundEmail(context.WorkspaceId, "Sent", original.FromEmail, subject, body, original.Id);
        });

    [McpServerTool(Name = "create_draft")]
    [Description("Create a simulated email draft without sending it.")]
    public CallToolResult CreateDraft(string to, string subject, string body) =>
        context.Execute("create_draft", new { to, subject, body },
            () => context.Store.CreateOutboundEmail(context.WorkspaceId, "Drafts", to, subject, body));

    [McpServerTool(Name = "list_folders")]
    [Description("List folders available in the simulated mailbox.")]
    public CallToolResult ListFolders() =>
        context.Execute("list_folders", new { }, () => context.Store.ListEmailFolders(context.WorkspaceId));

    [McpServerTool(Name = "list_contacts")]
    [Description("List or search contacts in the simulated address book.")]
    public CallToolResult ListContacts([Description("Search text, at most 250 characters.")] string? query = null) =>
        context.Execute("list_contacts", new { query }, () =>
        {
            if (query?.Length > 250) throw new ArgumentException("The contact search is too long.");
            return context.Store.ListEmailContacts(context.WorkspaceId, query);
        });
}
