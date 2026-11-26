using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Mockarium.Core.Mcp;

internal sealed class DatabaseTools(ToolContext context)
{
    [McpServerTool(Name = "database_schema")]
    [Description("Show the tables, fields, types, and relationships in this simulated database. Call this first to understand the available data.")]
    public CallToolResult Schema() =>
        context.Execute("database_schema", new { }, () =>
            context.Store.GetDatabaseModel(context.WorkspaceId)
            ?? throw new InvalidOperationException("The simulated database has not been set up."));

    [McpServerTool(Name = "database_list_records")]
    [Description("List records from one table. Optionally filter by a text query and limit the number of results.")]
    public CallToolResult ListRecords(string table, string? query = null, int? limit = null) =>
        context.Execute("database_list_records", new { table, query, limit }, () =>
        {
            if (query?.Length > 200) throw new ArgumentException("The database search is too long.");
            if (limit is < 1 or > 100) throw new ArgumentException("Limit must be between 1 and 100.");
            return context.Store.GetDatabaseRecords(context.WorkspaceId, table)
                .Where(record => string.IsNullOrEmpty(query) ||
                    MockariumJson.Serialize(record.Values).Contains(query, StringComparison.OrdinalIgnoreCase))
                .Take(limit ?? 50).ToArray();
        });

    [McpServerTool(Name = "database_get_record")]
    [Description("Get one record by its table name and record ID.")]
    public CallToolResult GetRecord(string table, string id) =>
        context.Execute("database_get_record", new { table, id }, () =>
            Get(table, id));

    [McpServerTool(Name = "database_create_record")]
    [Description("Create a record. Call database_schema first and use existing field names and relationship IDs.")]
    public CallToolResult CreateRecord(string table, Dictionary<string, JsonElement> values) =>
        context.Execute("database_create_record", new { table, values }, () =>
            context.Store.SaveDatabaseRecord(context.WorkspaceId, table, null, values));

    [McpServerTool(Name = "database_update_record")]
    [Description("Update an existing record; all values not provided are preserved.")]
    public CallToolResult UpdateRecord(string table, string id, Dictionary<string, JsonElement> values) =>
        context.Execute("database_update_record", new { table, id, values }, () =>
        {
            ArgumentNullException.ThrowIfNull(values);
            var merged = new Dictionary<string, JsonElement>(Get(table, id).Values, StringComparer.Ordinal);
            foreach (var (name, value) in values) merged[name] = value;
            return context.Store.SaveDatabaseRecord(context.WorkspaceId, table, id, merged);
        });

    [McpServerTool(Name = "database_delete_record")]
    [Description("Delete a simulated record. Linked records must be unlinked first.")]
    public CallToolResult DeleteRecord(string table, string id) =>
        context.Execute("database_delete_record", new { table, id }, () =>
        {
            context.Store.DeleteDatabaseRecord(context.WorkspaceId, table, id);
            return new { deleted = true, table, id };
        });

    private DatabaseRecord Get(string table, string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 100) throw new ArgumentException("Record ID is invalid.");
        return context.Store.GetDatabaseRecords(context.WorkspaceId, table)
            .FirstOrDefault(candidate => candidate.Id == id)
            ?? throw new InvalidOperationException($"Record \"{id}\" was not found in {table}.");
    }
}
