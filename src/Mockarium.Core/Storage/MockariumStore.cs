using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mockarium.Core.Storage;

public sealed partial class MockariumStore : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly object _gate = new();
    private SqliteTransaction? _transaction;
    private bool _disposed;

    public MockariumStore(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        if (databasePath != ":memory:")
        {
            var directory = Path.GetDirectoryName(Path.GetFullPath(databasePath));
            Directory.CreateDirectory(directory!);
        }

        _connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            DefaultTimeout = 5
        }.ToString());
        _connection.Open();
        try
        {
            Execute("PRAGMA journal_mode = WAL;");
            Migrate();
        }
        catch
        {
            _connection.Dispose();
            throw;
        }
    }

    public static string DefaultDatabasePath()
    {
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (string.IsNullOrWhiteSpace(applicationData))
        {
            throw new InvalidOperationException("The application data directory is unavailable.");
        }

        return ResolveDatabasePath(applicationData);
    }

    internal static string ResolveDatabasePath(string applicationData)
    {
        var originalPath = Path.Combine(applicationData, "mockarium", "mockarium.sqlite");
        var alternatePath = Path.Combine(applicationData, "Mockarium", "mockarium.sqlite");
        var originalExists = DatabaseExists(originalPath);
        var alternateExists = DatabaseExists(alternatePath);

        if (originalExists && alternateExists)
        {
            var names = Directory.EnumerateDirectories(applicationData)
                .Select(Path.GetFileName)
                .ToHashSet(StringComparer.Ordinal);
            if (names.Contains("mockarium") && names.Contains("Mockarium"))
            {
                throw new InvalidOperationException(
                    $"Two Mockarium databases were found: '{originalPath}' and '{alternatePath}'. " +
                    "Back up both databases and move the one you do not want to use elsewhere before restarting.");
            }
        }

        return !originalExists && alternateExists ? alternatePath : originalPath;
    }

    private static bool DatabaseExists(string path)
    {
        try
        {
            if ((File.GetAttributes(path) & FileAttributes.Directory) != 0)
                throw new IOException($"The database path '{path}' is a directory, not a file.");
            return true;
        }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }

    private void Migrate()
    {
        Execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS mock_servers (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              type TEXT NOT NULL CHECK (type IN ('email', 'database', 'calendar')),
              name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (workspace_id, type)
            );
            CREATE TABLE IF NOT EXISTS emails (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              id TEXT NOT NULL, folder TEXT NOT NULL, from_name TEXT NOT NULL, from_email TEXT NOT NULL,
              to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL,
              parent_email_id TEXT, PRIMARY KEY (workspace_id, id)
            );
            CREATE INDEX IF NOT EXISTS emails_workspace_folder_time ON emails(workspace_id, folder, sent_at DESC);
            CREATE TABLE IF NOT EXISTS email_folders (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              name TEXT NOT NULL, PRIMARY KEY (workspace_id, name)
            );
            CREATE TABLE IF NOT EXISTS email_profiles (
              workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
              name TEXT NOT NULL, email TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS contacts (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL, PRIMARY KEY (workspace_id, email)
            );
            CREATE TABLE IF NOT EXISTS database_models (
              workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, model_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS database_records (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              table_name TEXT NOT NULL, id TEXT NOT NULL, values_json TEXT NOT NULL,
              PRIMARY KEY (workspace_id, table_name, id)
            );
            CREATE TABLE IF NOT EXISTS calendar_profiles (
              workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
              name TEXT NOT NULL, email TEXT NOT NULL, time_zone TEXT NOT NULL, work_start TEXT NOT NULL,
              work_end TEXT NOT NULL, simulated_time TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS calendar_people (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL,
              time_zone TEXT NOT NULL, work_start TEXT NOT NULL, work_end TEXT NOT NULL,
              PRIMARY KEY (workspace_id, id)
            );
            CREATE TABLE IF NOT EXISTS calendar_events (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, id TEXT NOT NULL,
              title TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL, start_at TEXT NOT NULL,
              end_at TEXT NOT NULL, organizer_email TEXT NOT NULL, attendees_json TEXT NOT NULL,
              status TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
              PRIMARY KEY (workspace_id, id)
            );
            CREATE INDEX IF NOT EXISTS calendar_events_workspace_time ON calendar_events(workspace_id, start_at);
            CREATE TABLE IF NOT EXISTS execution_events (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              server_name TEXT NOT NULL, tool_name TEXT NOT NULL, input_json TEXT NOT NULL,
              output_json TEXT, duration_ms INTEGER NOT NULL, success INTEGER NOT NULL,
              error TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_workspace_time ON execution_events(workspace_id, created_at DESC);
            """);

        var serverSql = Scalar<string>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mock_servers'");
        if (serverSql is not null && !serverSql.Contains("'calendar'", StringComparison.Ordinal))
        {
            InTransaction(() => Execute("""
                ALTER TABLE mock_servers RENAME TO mock_servers_legacy;
                CREATE TABLE mock_servers (
                  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                  type TEXT NOT NULL CHECK (type IN ('email', 'database', 'calendar')),
                  name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (workspace_id, type)
                );
                INSERT INTO mock_servers (id, workspace_id, type, name, created_at)
                  SELECT id, workspace_id, type, name, created_at FROM mock_servers_legacy;
                DROP TABLE mock_servers_legacy;
                """));
        }
    }

    private SqliteCommand Command(string sql, params (string Name, object? Value)[] parameters)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var command = _connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = _transaction;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }

        return command;
    }

    private int Execute(string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        return command.ExecuteNonQuery();
    }

    private T? Scalar<T>(string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        var result = command.ExecuteScalar();
        return result is null or DBNull ? default : (T)Convert.ChangeType(result, typeof(T), CultureInfo.InvariantCulture);
    }

    private List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        using var reader = command.ExecuteReader();
        var result = new List<T>();
        while (reader.Read()) result.Add(map(reader));
        return result;
    }

    private void InTransaction(Action action)
    {
        if (_transaction is not null) throw new InvalidOperationException("Nested transactions are not supported.");
        using var transaction = _connection.BeginTransaction();
        _transaction = transaction;
        try
        {
            action();
            transaction.Commit();
        }
        finally
        {
            _transaction = null;
        }
    }

    private static string NewId() => Guid.NewGuid().ToString();

    private static string Now() => Instant(DateTimeOffset.UtcNow);

    private static string Instant(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static string RequiredText(string? value, string label, int maximum)
    {
        var result = value?.Trim();
        if (string.IsNullOrEmpty(result) || result.Length > maximum)
            throw new ArgumentException($"{label} must contain between 1 and {maximum} characters.");
        return result;
    }

    private static void CheckEmail(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 254 ||
            !Regex.IsMatch(value, @"^[^\s@]+@[^\s@]+\.[^\s@]+$", RegexOptions.CultureInvariant))
            throw new ArgumentException($"{label} must be a valid email address.");
    }

    private static string NormalizeInstant(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 40 ||
            !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var instant))
            throw new ArgumentException($"{label} must be a valid date and time.");
        return Instant(instant);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _connection.Dispose();
            _disposed = true;
        }
    }
}
