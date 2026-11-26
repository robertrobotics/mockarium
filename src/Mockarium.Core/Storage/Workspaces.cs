namespace Mockarium.Core.Storage;

public sealed partial class MockariumStore
{
    public bool GetReduceMotion()
    {
        lock (_gate)
        {
            return Scalar<string>("SELECT value FROM app_settings WHERE key = 'reduceMotion'") switch
            {
                null or "false" => false,
                "true" => true,
                _ => throw new InvalidDataException("The saved motion preference is invalid.")
            };
        }
    }

    public void SetReduceMotion(bool value)
    {
        lock (_gate)
        {
            Execute(
                """
                INSERT INTO app_settings (key, value) VALUES ('reduceMotion', $value)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                ("$value", value ? "true" : "false"));
        }
    }

    public IReadOnlyList<Workspace> ListWorkspaces()
    {
        lock (_gate)
        {
            return Query(
                "SELECT id, name, created_at, updated_at FROM workspaces ORDER BY created_at",
                row => new Workspace(row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3)));
        }
    }

    public Workspace GetWorkspace(string workspaceId)
    {
        lock (_gate)
        {
            return Query(
                "SELECT id, name, created_at, updated_at FROM workspaces WHERE id = $id",
                row => new Workspace(row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3)),
                ("$id", workspaceId)).SingleOrDefault()
                ?? throw new InvalidOperationException("Workspace not found.");
        }
    }

    public string? GetActiveWorkspaceId()
    {
        lock (_gate)
            return Scalar<string>("SELECT value FROM app_settings WHERE key = 'activeWorkspaceId'");
    }

    public Workspace CreateWorkspace(string name)
    {
        lock (_gate)
        {
            var now = Now();
            var workspace = new Workspace(NewId(), RequiredText(name, "Workspace name", 80), now, now);
            InTransaction(() =>
            {
                Execute(
                    "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ($id, $name, $now, $now)",
                    ("$id", workspace.Id), ("$name", workspace.Name), ("$now", now));
                SelectWorkspace(workspace.Id);
            });
            return workspace;
        }
    }

    public Workspace RenameWorkspace(string workspaceId, string name)
    {
        lock (_gate)
        {
            var changed = Execute(
                "UPDATE workspaces SET name = $name, updated_at = $now WHERE id = $id",
                ("$name", RequiredText(name, "Workspace name", 80)), ("$now", Now()), ("$id", workspaceId));
            if (changed == 0) throw new InvalidOperationException("Workspace not found.");
            return GetWorkspace(workspaceId);
        }
    }

    public void SelectWorkspace(string workspaceId)
    {
        lock (_gate)
        {
            GetWorkspace(workspaceId);
            Execute(
                """
                INSERT INTO app_settings (key, value) VALUES ('activeWorkspaceId', $id)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                ("$id", workspaceId));
        }
    }

    public void DeleteWorkspace(string workspaceId)
    {
        lock (_gate)
        {
            InTransaction(() =>
            {
                var activeId = GetActiveWorkspaceId();
                if (Execute("DELETE FROM workspaces WHERE id = $id", ("$id", workspaceId)) == 0)
                    throw new InvalidOperationException("Workspace not found.");
                if (activeId != workspaceId) return;
                var next = ListWorkspaces().FirstOrDefault();
                if (next is not null) SelectWorkspace(next.Id);
                else Execute("DELETE FROM app_settings WHERE key = 'activeWorkspaceId'");
            });
        }
    }

    public IReadOnlyList<MockServer> ListServers(string? workspaceId = null)
    {
        lock (_gate)
        {
            return Query(
                """
                SELECT id, workspace_id, type, name, created_at FROM mock_servers
                WHERE ($workspace IS NULL OR workspace_id = $workspace) ORDER BY created_at
                """,
                row => new MockServer(row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3), row.GetString(4)),
                ("$workspace", workspaceId));
        }
    }

    public MockServer? GetServer(string workspaceId, string serverId)
    {
        lock (_gate)
            return ListServers(workspaceId).FirstOrDefault(server => server.Id == serverId);
    }

    public MockServer AddServer(string workspaceId, string type)
    {
        lock (_gate)
        {
            GetWorkspace(workspaceId);
            var name = type switch
            {
                "email" => "Email",
                "database" => "Database",
                "calendar" => "Calendar",
                _ => throw new ArgumentException("Unsupported mock server type.", nameof(type))
            };
            if (ListServers(workspaceId).Any(server => server.Type == type))
                throw new InvalidOperationException($"This workspace already has a {name} mock server.");
            var result = new MockServer(NewId(), workspaceId, type, name, Now());
            InTransaction(() =>
            {
                Execute(
                    """
                    INSERT INTO mock_servers (id, workspace_id, type, name, created_at)
                    VALUES ($id, $workspace, $type, $name, $created)
                    """,
                    ("$id", result.Id), ("$workspace", workspaceId), ("$type", type),
                    ("$name", name), ("$created", result.CreatedAt));
                switch (type)
                {
                    case "email": SeedEmail(workspaceId); break;
                    case "database": SeedDatabase(workspaceId); break;
                    case "calendar": SeedCalendar(workspaceId); break;
                }
            });
            return result;
        }
    }

    private void RequireServer(string workspaceId, string type)
    {
        GetWorkspace(workspaceId);
        if (!ListServers(workspaceId).Any(server => server.Type == type))
            throw new InvalidOperationException($"Add the {type} mock server first.");
    }

    public ExecutionEvent RecordEvent(
        string workspaceId,
        string serverName,
        string toolName,
        System.Text.Json.JsonElement input,
        System.Text.Json.JsonElement? output,
        int durationMs,
        string? error)
    {
        lock (_gate)
        {
            var entry = new ExecutionEvent(
                NewId(), workspaceId, serverName, toolName, input.Clone(), output?.Clone(),
                Math.Max(0, durationMs), error is null, error, Now());
            InTransaction(() =>
            {
                Execute(
                    """
                    INSERT INTO execution_events
                      (id, workspace_id, server_name, tool_name, input_json, output_json, duration_ms, success, error, created_at)
                    VALUES ($id, $workspace, $server, $tool, $input, $output, $duration, $success, $error, $created)
                    """,
                    ("$id", entry.Id), ("$workspace", workspaceId), ("$server", serverName), ("$tool", toolName),
                    ("$input", input.GetRawText()), ("$output", output?.GetRawText()), ("$duration", entry.DurationMs),
                    ("$success", entry.Success ? 1 : 0), ("$error", error), ("$created", entry.CreatedAt));
                Execute(
                    """
                    DELETE FROM execution_events WHERE workspace_id = $workspace AND id NOT IN
                      (SELECT id FROM execution_events WHERE workspace_id = $workspace
                       ORDER BY created_at DESC, rowid DESC LIMIT 1000)
                    """,
                    ("$workspace", workspaceId));
            });
            return entry;
        }
    }

    public IReadOnlyList<ExecutionEvent> ListEvents(string workspaceId, int limit = 100)
    {
        if (limit is < 1 or > 1000) throw new ArgumentOutOfRangeException(nameof(limit));
        lock (_gate)
        {
            GetWorkspace(workspaceId);
            return Query(
                """
                SELECT id, workspace_id, server_name, tool_name, input_json, output_json,
                       duration_ms, success, error, created_at
                FROM execution_events WHERE workspace_id = $workspace
                ORDER BY created_at DESC, rowid DESC LIMIT $limit
                """,
                row => new ExecutionEvent(
                    row.GetString(0), row.GetString(1), row.GetString(2), row.GetString(3),
                    MockariumJson.Deserialize<System.Text.Json.JsonElement>(row.GetString(4)),
                    row.IsDBNull(5) ? null : MockariumJson.Deserialize<System.Text.Json.JsonElement>(row.GetString(5)),
                    row.GetInt32(6), row.GetInt32(7) != 0, row.IsDBNull(8) ? null : row.GetString(8), row.GetString(9)),
                ("$workspace", workspaceId), ("$limit", limit));
        }
    }
}
