using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mockarium.Core.Storage;

public sealed partial class MockariumStore
{
    public DatabaseModel? GetDatabaseModel(string workspaceId)
    {
        lock (_gate)
        {
            var json = Scalar<string>(
                "SELECT model_json FROM database_models WHERE workspace_id = $workspace",
                ("$workspace", workspaceId));
            return json is null ? null : MockariumJson.Deserialize<DatabaseModel>(json);
        }
    }

    public DatabaseModel SaveDatabaseModel(string workspaceId, DatabaseModel model)
    {
        lock (_gate)
        {
            model = ValidateModel(model);
            var existing = GetDatabaseModel(workspaceId)
                ?? throw new InvalidOperationException("Add the Database mock before editing it.");
            var nextNames = model.Tables.Select(table => table.Name).ToHashSet(StringComparer.Ordinal);
            foreach (var old in existing.Tables)
            {
                if (!nextNames.Contains(old.Name) && GetDatabaseRecords(workspaceId, old.Name).Count > 0)
                    throw new InvalidOperationException($"Move or delete the {old.Label} records before removing this table.");
            }

            var updates = new List<(string Table, string Id, Dictionary<string, JsonElement> Values)>();
            foreach (var table in model.Tables.Where(table => existing.Tables.Any(old => old.Name == table.Name)))
            {
                var fields = table.Fields.Select(field => field.Name).ToHashSet(StringComparer.Ordinal);
                foreach (var record in GetDatabaseRecords(workspaceId, table.Name))
                {
                    var values = record.Values.Where(pair => fields.Contains(pair.Key))
                        .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
                    ValidateDatabaseValues(workspaceId, model, table.Name, values, record.Id);
                    if (values.Count != record.Values.Count) updates.Add((table.Name, record.Id, values));
                }
            }

            InTransaction(() =>
            {
                foreach (var update in updates)
                {
                    Execute(
                        """
                        UPDATE database_records SET values_json = $values
                        WHERE workspace_id = $workspace AND table_name = $table AND id = $id
                        """,
                        ("$values", MockariumJson.Serialize(update.Values)), ("$workspace", workspaceId),
                        ("$table", update.Table), ("$id", update.Id));
                }
                Execute(
                    "UPDATE database_models SET model_json = $model WHERE workspace_id = $workspace",
                    ("$model", MockariumJson.Serialize(model)), ("$workspace", workspaceId));
                foreach (var old in existing.Tables.Where(table => !nextNames.Contains(table.Name)))
                    Execute("DELETE FROM database_records WHERE workspace_id = $workspace AND table_name = $table",
                        ("$workspace", workspaceId), ("$table", old.Name));
            });
            return model;
        }
    }

    public IReadOnlyList<DatabaseRecord> GetDatabaseRecords(string workspaceId, string tableName)
    {
        lock (_gate)
        {
            var model = GetDatabaseModel(workspaceId);
            if (model is null || !model.Tables.Any(table => table.Name == tableName))
                throw new InvalidOperationException($"Table \"{tableName}\" does not exist in this database.");
            return Query(
                """
                SELECT id, values_json FROM database_records
                WHERE workspace_id = $workspace AND table_name = $table ORDER BY rowid
                """,
                row => new DatabaseRecord(row.GetString(0),
                    MockariumJson.Deserialize<Dictionary<string, JsonElement>>(row.GetString(1))),
                ("$workspace", workspaceId), ("$table", tableName));
        }
    }

    public DatabaseRecord SaveDatabaseRecord(
        string workspaceId, string tableName, string? recordId, Dictionary<string, JsonElement> values,
        DatabaseRecord? expected = null)
    {
        lock (_gate)
        {
            var model = GetDatabaseModel(workspaceId)
                ?? throw new InvalidOperationException("Add the Database mock before editing data.");
            ArgumentNullException.ThrowIfNull(values);
            if (expected is not null) RequireUnchangedRecord(workspaceId, tableName, recordId, expected);
            ValidateDatabaseValues(workspaceId, model, tableName, values, recordId);
            var id = recordId ?? NewId();
            if (recordId is not null)
            {
                var changed = Execute(
                    """
                    UPDATE database_records SET values_json = $values
                    WHERE workspace_id = $workspace AND table_name = $table AND id = $id
                    """,
                    ("$values", MockariumJson.Serialize(values)), ("$workspace", workspaceId),
                    ("$table", tableName), ("$id", id));
                if (changed == 0) throw new InvalidOperationException("Record not found.");
            }
            else
            {
                var count = Scalar<long>(
                    "SELECT COUNT(*) FROM database_records WHERE workspace_id = $workspace AND table_name = $table",
                    ("$workspace", workspaceId), ("$table", tableName));
                if (count >= 500) throw new InvalidOperationException($"The {tableName} table has reached its 500-record safety limit.");
                Execute(
                    """
                    INSERT INTO database_records (workspace_id, table_name, id, values_json)
                    VALUES ($workspace, $table, $id, $values)
                    """,
                    ("$workspace", workspaceId), ("$table", tableName), ("$id", id),
                    ("$values", MockariumJson.Serialize(values)));
            }
            return new DatabaseRecord(id, values);
        }
    }

    public void DeleteDatabaseRecord(string workspaceId, string tableName, string recordId, DatabaseRecord? expected = null)
    {
        lock (_gate)
        {
            var model = GetDatabaseModel(workspaceId);
            if (model is null || !model.Tables.Any(table => table.Name == tableName))
                throw new InvalidOperationException($"Table \"{tableName}\" does not exist in this database.");
            if (expected is not null) RequireUnchangedRecord(workspaceId, tableName, recordId, expected);
            foreach (var table in model.Tables)
            {
                var fields = table.Fields.Where(field => field.Type == "relation" && field.RelationTo == tableName);
                foreach (var field in fields)
                {
                    if (GetDatabaseRecords(workspaceId, table.Name).Any(record =>
                        record.Values.TryGetValue(field.Name, out var value) &&
                        value.ValueKind == JsonValueKind.String && value.GetString() == recordId))
                        throw new InvalidOperationException($"This record is still linked from {table.Label}. Remove those relationships first.");
                }

            }
            if (Execute(
                "DELETE FROM database_records WHERE workspace_id = $workspace AND table_name = $table AND id = $id",
                ("$workspace", workspaceId), ("$table", tableName), ("$id", recordId)) == 0)
                throw new InvalidOperationException("Record not found.");
        }
    }

    private void RequireUnchangedRecord(string workspaceId, string tableName, string? recordId, DatabaseRecord expected)
    {
        var current = GetDatabaseRecords(workspaceId, tableName).FirstOrDefault(record => record.Id == recordId);
        if (current is null || current.Id != expected.Id ||
            MockariumJson.Serialize(current.Values) != MockariumJson.Serialize(expected.Values))
            throw new InvalidOperationException("This record changed while you were editing it. Refresh or reselect it before saving.");
    }

    public void ResetDatabase(string workspaceId)
    {
        lock (_gate)
        {
            RequireServer(workspaceId, "database");
            InTransaction(() =>
            {
                Execute("DELETE FROM database_records WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                Execute("DELETE FROM database_models WHERE workspace_id = $workspace", ("$workspace", workspaceId));
                SeedDatabase(workspaceId);
            });
        }
    }

    private static DatabaseModel ValidateModel(DatabaseModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.Tables is null || model.Tables.Count is < 1 or > 12)
            throw new ArgumentException("A database must have between 1 and 12 tables.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var normalized = new List<DatabaseTable>();
        foreach (var table in model.Tables)
        {
            if (table is null || !ValidIdentifier(table.Name) || !ValidIdentifier(table.Id))
                throw new ArgumentException("Table names and IDs must start with a lowercase letter and contain only lowercase letters, digits or underscores.");
            if (!names.Add(table.Name) || !ids.Add(table.Id))
                throw new ArgumentException($"Table name and ID must be unique: \"{table.Name}\".");
            if (table.Fields is null || table.Fields.Count is < 1 or > 20)
                throw new ArgumentException("A table must have between 1 and 20 fields.");
            var fieldNames = new HashSet<string>(StringComparer.Ordinal);
            var fieldIds = new HashSet<string>(StringComparer.Ordinal);
            var fields = new List<DatabaseField>();
            foreach (var field in table.Fields)
            {
                if (field is null || !ValidIdentifier(field.Name) || field.Name == "id" ||
                    string.IsNullOrEmpty(field.Id) || field.Id.Length > 80)
                    throw new ArgumentException("Field names and IDs are invalid; \"id\" is reserved.");
                if (!fieldNames.Add(field.Name) || !fieldIds.Add(field.Id))
                    throw new ArgumentException($"Field name and ID must be unique: \"{field.Name}\".");
                if (field.Type is not ("text" or "email" or "number" or "boolean" or "date" or "relation"))
                    throw new ArgumentException($"The \"{field.Name}\" field has an unsupported type.");
                if (field.Type == "relation" &&
                    (field.RelationTo is null || !model.Tables.Any(target => target.Name == field.RelationTo)))
                    throw new ArgumentException($"The \"{field.Label}\" relationship points to a missing table.");
                if (field.Type != "relation" && field.RelationTo is not null)
                    throw new ArgumentException("Only relationship fields can point to another table.");
                fields.Add(field with { Label = RequiredText(field.Label, "Field label", 60) });
            }
            normalized.Add(table with { Label = RequiredText(table.Label, "Table label", 60), Fields = fields });
        }
        return new DatabaseModel(normalized);
    }

    private static bool ValidIdentifier(string? value) =>
        value is not null && Regex.IsMatch(value, "^[a-z][a-z0-9_]{0,39}$", RegexOptions.CultureInvariant);

    private void ValidateDatabaseValues(
        string workspaceId, DatabaseModel model, string tableName,
        Dictionary<string, JsonElement> values, string? recordId)
    {
        var table = model.Tables.SingleOrDefault(candidate => candidate.Name == tableName)
            ?? throw new InvalidOperationException($"Table \"{tableName}\" does not exist.");
        foreach (var name in values.Keys)
        {
            if (!table.Fields.Any(field => field.Name == name))
                throw new ArgumentException($"Unknown field \"{name}\" in {table.Label}.");
        }
        foreach (var field in table.Fields)
        {
            if (!values.TryGetValue(field.Name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ||
                (value.ValueKind == JsonValueKind.String && value.GetString() == ""))
            {
                if (field.Required) throw new ArgumentException($"The \"{field.Label}\" field is required.");
                continue;
            }

            var text = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            if (text is not null && text.Length > (field.Type == "email" ? 254 : field.Type == "date" ? 40 : 2000))
                throw new ArgumentException($"The \"{field.Label}\" field is too long.");
            switch (field.Type)
            {
                case "text" when text is null:
                    throw new ArgumentException($"The \"{field.Label}\" field must be text.");
                case "email":
                    CheckEmail(text, $"The \"{field.Label}\" field");
                    break;
                case "number" when value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number):
                    throw new ArgumentException($"The \"{field.Label}\" field must be a number.");
                case "boolean" when value.ValueKind is not (JsonValueKind.True or JsonValueKind.False):
                    throw new ArgumentException($"The \"{field.Label}\" field must be true or false.");
                case "date" when text is null || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out _):
                    throw new ArgumentException($"The \"{field.Label}\" field must be a valid date.");
                case "relation":
                    if (text is null || field.RelationTo is null)
                        throw new ArgumentException($"The \"{field.Label}\" field must link to a record.");
                    var exists = Scalar<long>(
                        "SELECT COUNT(*) FROM database_records WHERE workspace_id = $workspace AND table_name = $table AND id = $id",
                        ("$workspace", workspaceId), ("$table", field.RelationTo), ("$id", text)) > 0;
                    if (!exists && !(field.RelationTo == tableName && text == recordId))
                        throw new ArgumentException($"The selected record for \"{field.Label}\" no longer exists.");
                    break;
            }
        }
    }

    private void SeedDatabase(string workspaceId)
    {
        static DatabaseField Field(string id, string name, string label, string type, bool required = false, string? relationTo = null) =>
            new(id, name, label, type, required, relationTo);
        var model = new DatabaseModel([
            new("companies", "companies", "Companies", [
                Field("company_name", "name", "Company name", "text", true),
                Field("industry", "industry", "Industry", "text"),
                Field("website", "website", "Website", "text"),
                Field("account_status", "status", "Account status", "text")]),
            new("contacts", "contacts", "Contacts", [
                Field("contact_name", "name", "Full name", "text", true),
                Field("contact_email", "email", "Email", "email", true),
                Field("contact_role", "role", "Role", "text"),
                Field("contact_company", "company", "Company", "relation", true, "companies")]),
            new("deals", "deals", "Deals", [
                Field("deal_name", "name", "Deal name", "text", true),
                Field("deal_amount", "amount", "Amount", "number", true),
                Field("deal_stage", "stage", "Stage", "text", true),
                Field("deal_company", "company", "Company", "relation", true, "companies")])
        ]);
        Execute("INSERT INTO database_models (workspace_id, model_json) VALUES ($workspace, $model)",
            ("$workspace", workspaceId), ("$model", MockariumJson.Serialize(model)));
        var records = new (string Table, string Id, object Values)[]
        {
            ("companies", "company_northstar", new { name = "Northstar Labs", industry = "Climate technology", website = "northstarlabs.example.test", status = "Customer" }),
            ("companies", "company_brightline", new { name = "Brightline Supply", industry = "Manufacturing", website = "brightline.example.test", status = "Prospect" }),
            ("contacts", "contact_jordan", new { name = "Jordan Lee", email = "jordan.lee@example.test", role = "Operations lead", company = "company_northstar" }),
            ("contacts", "contact_priya", new { name = "Priya Shah", email = "priya.shah@example.test", role = "Procurement director", company = "company_brightline" }),
            ("deals", "deal_launch", new { name = "Spring launch program", amount = 24000, stage = "Proposal", company = "company_northstar" }),
            ("deals", "deal_renewal", new { name = "Annual supply renewal", amount = 12500, stage = "Negotiation", company = "company_brightline" })
        };
        foreach (var (table, id, values) in records)
        {
            Execute(
                "INSERT INTO database_records (workspace_id, table_name, id, values_json) VALUES ($workspace, $table, $id, $values)",
                ("$workspace", workspaceId), ("$table", table), ("$id", id), ("$values", MockariumJson.Serialize(values)));
        }
    }
}
