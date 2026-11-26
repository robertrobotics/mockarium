namespace Mockarium.Core.Storage;

public sealed partial class MockariumStore
{
    private static readonly string[] StandardFolders = ["Inbox", "Sent", "Drafts", "Archive"];

    public EmailProfile GetEmailProfile(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            var profile = Query("SELECT name, email FROM email_profiles WHERE workspace_id = $workspace",
                row => new EmailProfile(row.GetString(0), row.GetString(1)), ("$workspace", workspaceId)).SingleOrDefault();
            if (profile is not null) return profile;
            profile = new EmailProfile("Alex Morgan", "alex@example.test");
            Execute("INSERT INTO email_profiles (workspace_id, name, email) VALUES ($workspace, $name, $email)",
                ("$workspace", workspaceId), ("$name", profile.Name), ("$email", profile.Email));
            return profile;
        }
    }

    public EmailProfile SaveEmailProfile(string workspaceId, EmailProfile profile)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            ArgumentNullException.ThrowIfNull(profile);
            var name = RequiredText(profile.Name, "Name", 80);
            var email = profile.Email?.Trim();
            CheckEmail(email, "Email");
            Execute(
                """
                INSERT INTO email_profiles (workspace_id, name, email) VALUES ($workspace, $name, $email)
                ON CONFLICT(workspace_id) DO UPDATE SET name = excluded.name, email = excluded.email
                """,
                ("$workspace", workspaceId), ("$name", name), ("$email", email));
            return new EmailProfile(name, email!);
        }
    }

    public IReadOnlyList<string> ListEmailFolders(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            return Query("SELECT name FROM email_folders WHERE workspace_id = $workspace ORDER BY rowid",
                row => row.GetString(0), ("$workspace", workspaceId));
        }
    }

    public IReadOnlyList<string> AddEmailFolder(string workspaceId, string name)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            name = RequiredText(name, "Folder name", 40);
            if (Scalar<long>(
                "SELECT COUNT(*) FROM email_folders WHERE workspace_id = $workspace AND lower(name) = lower($name)",
                ("$workspace", workspaceId), ("$name", name)) > 0)
                throw new InvalidOperationException($"A \"{name}\" folder already exists.");
            Execute("INSERT INTO email_folders (workspace_id, name) VALUES ($workspace, $name)",
                ("$workspace", workspaceId), ("$name", name));
            return ListEmailFolders(workspaceId);
        }
    }

    public IReadOnlyList<string> DeleteEmailFolder(string workspaceId, string name)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            if (StandardFolders.Contains(name, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException("The standard mailbox folders cannot be removed.");
            if (Scalar<long>("SELECT COUNT(*) FROM emails WHERE workspace_id = $workspace AND folder = $name",
                ("$workspace", workspaceId), ("$name", name)) > 0)
                throw new InvalidOperationException("Move or delete the messages in this folder first.");
            if (Execute("DELETE FROM email_folders WHERE workspace_id = $workspace AND name = $name",
                ("$workspace", workspaceId), ("$name", name)) == 0)
                throw new InvalidOperationException("Folder not found.");
            return ListEmailFolders(workspaceId);
        }
    }

    public IReadOnlyList<EmailContact> ListEmailContacts(string workspaceId, string? query = null)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            return Query(
                """
                SELECT name, email, company FROM contacts WHERE workspace_id = $workspace
                  AND ($query IS NULL OR instr(lower(name), lower($query)) > 0
                       OR instr(lower(email), lower($query)) > 0 OR instr(lower(company), lower($query)) > 0)
                ORDER BY name
                """,
                row => new EmailContact(row.GetString(0), row.GetString(1), row.GetString(2)),
                ("$workspace", workspaceId), ("$query", query));
        }
    }

    public IReadOnlyList<EmailContact> SaveEmailContact(string workspaceId, string? existingEmail, EmailContact contact)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            ArgumentNullException.ThrowIfNull(contact);
            var name = RequiredText(contact.Name, "Contact name", 80);
            var email = contact.Email?.Trim();
            CheckEmail(email, "Contact email");
            var company = contact.Company?.Trim() ?? throw new ArgumentException("Company is required.");
            if (company.Length > 120) throw new ArgumentException("Company is too long.");
            if (Scalar<long>(
                """
                SELECT COUNT(*) FROM contacts WHERE workspace_id = $workspace AND lower(email) = lower($email)
                  AND ($existing IS NULL OR email != $existing)
                """,
                ("$workspace", workspaceId), ("$email", email), ("$existing", existingEmail)) > 0)
                throw new InvalidOperationException("A contact with this email already exists.");
            if (existingEmail is null)
            {
                Execute(
                    "INSERT INTO contacts (workspace_id, name, email, company) VALUES ($workspace, $name, $email, $company)",
                    ("$workspace", workspaceId), ("$name", name), ("$email", email), ("$company", company));
            }
            else if (Execute(
                "UPDATE contacts SET name = $name, email = $email, company = $company WHERE workspace_id = $workspace AND email = $existing",
                ("$workspace", workspaceId), ("$name", name), ("$email", email), ("$company", company),
                ("$existing", existingEmail)) == 0)
            {
                throw new InvalidOperationException("Contact not found.");
            }
            return ListEmailContacts(workspaceId);
        }
    }

    public IReadOnlyList<EmailContact> DeleteEmailContact(string workspaceId, string email)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            if (Execute("DELETE FROM contacts WHERE workspace_id = $workspace AND email = $email",
                ("$workspace", workspaceId), ("$email", email)) == 0)
                throw new InvalidOperationException("Contact not found.");
            return ListEmailContacts(workspaceId);
        }
    }

    public IReadOnlyList<EmailMessage> SearchEmails(string workspaceId, string? query = null, string? folder = null, int limit = 100)
    {
        if (limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        if (query?.Length > 250 || folder?.Length > 80) throw new ArgumentException("The email search is too long.");
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            return Query(
                """
                SELECT id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id
                FROM emails WHERE workspace_id = $workspace AND ($folder IS NULL OR folder = $folder)
                  AND ($query IS NULL OR instr(lower(subject), lower($query)) > 0
                       OR instr(lower(body), lower($query)) > 0 OR instr(lower(from_email), lower($query)) > 0
                       OR instr(lower(from_name), lower($query)) > 0)
                ORDER BY sent_at DESC LIMIT $limit
                """,
                row => new EmailMessage(
                    row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3), row.GetString(4),
                    row.GetString(5), row.GetString(6), row.GetString(7), row.GetString(8),
                    row.IsDBNull(9) ? null : row.GetString(9)),
                ("$workspace", workspaceId), ("$folder", string.IsNullOrEmpty(folder) ? null : folder),
                ("$query", string.IsNullOrEmpty(query) ? null : query), ("$limit", limit));
        }
    }

    public EmailMessage? GetEmail(string workspaceId, string emailId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            return Query(
                """
                SELECT id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id
                FROM emails WHERE workspace_id = $workspace AND id = $id
                """,
                row => new EmailMessage(
                    row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3), row.GetString(4),
                    row.GetString(5), row.GetString(6), row.GetString(7), row.GetString(8),
                    row.IsDBNull(9) ? null : row.GetString(9)),
                ("$workspace", workspaceId), ("$id", emailId)).SingleOrDefault();
        }
    }

    public EmailMessage SaveEmail(string workspaceId, string? emailId, EmailMessageInput input)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            ArgumentNullException.ThrowIfNull(input);
            var folder = RequiredText(input.Folder, "Folder", 40);
            var fromName = RequiredText(input.FromName, "Sender name", 80);
            var fromEmail = input.FromEmail?.Trim();
            var toEmail = input.ToEmail?.Trim();
            CheckEmail(fromEmail, "Sender email");
            CheckEmail(toEmail, "Recipient email");
            var subject = RequiredText(input.Subject, "Subject", 300);
            if (string.IsNullOrEmpty(input.Body) || input.Body.Length > 20_000)
                throw new ArgumentException("Message body must contain between 1 and 20000 characters.");
            var sentAt = NormalizeInstant(input.SentAt, "Sent time");
            if (!ListEmailFolders(workspaceId).Contains(folder))
                throw new InvalidOperationException($"The \"{folder}\" folder does not exist.");
            if (input.ParentEmailId is not null &&
                (input.ParentEmailId.Length is < 1 or > 100 || input.ParentEmailId == emailId ||
                 GetEmail(workspaceId, input.ParentEmailId) is null))
                throw new InvalidOperationException("Choose an existing message for this email thread.");
            if (emailId is not null && GetEmail(workspaceId, emailId) is null)
                throw new InvalidOperationException("Email not found.");
            var email = new EmailMessage(emailId ?? NewId(), workspaceId, folder, fromName, fromEmail!, toEmail!,
                subject, input.Body, sentAt, input.ParentEmailId);
            UpsertEmail(email);
            return email;
        }
    }

    public EmailMessage CreateOutboundEmail(string workspaceId, string folder, string to, string subject, string body, string? parentEmailId = null)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            CheckEmail(to, "Recipient email");
            if (subject.Length is < 1 or > 300 || string.IsNullOrWhiteSpace(subject))
                throw new ArgumentException("Subject must contain between 1 and 300 characters.");
            if (body.Length > 20_000 || (folder != "Drafts" && body.Length == 0))
                throw new ArgumentException("Message body is invalid.");
            if (folder is not ("Sent" or "Drafts")) throw new ArgumentException("Invalid outgoing folder.");
            if (parentEmailId is not null && GetEmail(workspaceId, parentEmailId) is null)
                throw new InvalidOperationException("The original email was not found.");
            var profile = GetEmailProfile(workspaceId);
            var email = new EmailMessage(NewId(), workspaceId, folder, profile.Name, profile.Email, to, subject, body, Now(), parentEmailId);
            UpsertEmail(email);
            return email;
        }
    }

    private void UpsertEmail(EmailMessage email)
    {
        Execute(
            """
            INSERT INTO emails (id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id)
            VALUES ($id, $workspace, $folder, $name, $from, $to, $subject, $body, $sent, $parent)
            ON CONFLICT(workspace_id, id) DO UPDATE SET folder = excluded.folder, from_name = excluded.from_name,
              from_email = excluded.from_email, to_email = excluded.to_email, subject = excluded.subject,
              body = excluded.body, sent_at = excluded.sent_at, parent_email_id = excluded.parent_email_id
            """,
            ("$id", email.Id), ("$workspace", email.WorkspaceId), ("$folder", email.Folder),
            ("$name", email.FromName), ("$from", email.FromEmail), ("$to", email.ToEmail),
            ("$subject", email.Subject), ("$body", email.Body), ("$sent", email.SentAt), ("$parent", email.ParentEmailId));
    }

    public void DeleteEmail(string workspaceId, string emailId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            if (GetEmail(workspaceId, emailId) is null) throw new InvalidOperationException("Email not found.");
            InTransaction(() =>
            {
                Execute("UPDATE emails SET parent_email_id = NULL WHERE workspace_id = $workspace AND parent_email_id = $id",
                    ("$workspace", workspaceId), ("$id", emailId));
                Execute("DELETE FROM emails WHERE workspace_id = $workspace AND id = $id",
                    ("$workspace", workspaceId), ("$id", emailId));
            });
        }
    }

    public void ResetEmail(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "email");
            InTransaction(() =>
            {
                Execute("DELETE FROM emails WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM email_folders WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM contacts WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM email_profiles WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                SeedEmail(workspaceId);
            });
        }
    }

    private void SeedEmail(string workspaceId)
    {
        Execute("INSERT INTO email_profiles (workspace_id, name, email) VALUES ($workspace, 'Alex Morgan', 'alex@example.test')",
            ("$workspace", workspaceId));
        foreach (var folder in StandardFolders)
            Execute("INSERT INTO email_folders (workspace_id, name) VALUES ($workspace, $name)",
                ("$workspace", workspaceId), ("$name", folder));
        foreach (var contact in new[]
        {
            new EmailContact("Jordan Lee", "jordan.lee@example.test", "Northstar Labs"),
            new EmailContact("Priya Shah", "priya.shah@example.test", "Brightline Supply"),
            new EmailContact("Morgan Chen", "morgan.chen@example.test", "Fieldwork Studio")
        })
            Execute("INSERT INTO contacts (workspace_id, name, email, company) VALUES ($workspace, $name, $email, $company)",
                ("$workspace", workspaceId), ("$name", contact.Name), ("$email", contact.Email), ("$company", contact.Company));
        foreach (var email in new[]
        {
            new EmailMessage("email-001", workspaceId, "Inbox", "Jordan Lee", "jordan.lee@example.test", "alex@example.test",
                "Q3 planning notes", "Hi Alex, I have attached the draft Q3 planning notes. Could you review the launch dates before Friday?", "2025-03-04T14:30:00.000Z", null),
            new EmailMessage("email-002", workspaceId, "Inbox", "Priya Shah", "priya.shah@example.test", "alex@example.test",
                "Re: Vendor renewal", "The renewal proposal looks good. Please confirm whether the updated support terms are included.", "2025-03-03T09:15:00.000Z", null),
            new EmailMessage("email-003", workspaceId, "Inbox", "Morgan Chen", "morgan.chen@example.test", "alex@example.test",
                "Design review follow-up", "Thanks for the thoughtful review. I will share the revised mockups and accessibility checklist tomorrow.", "2025-03-01T16:45:00.000Z", null)
        })
            UpsertEmail(email);
    }
}
