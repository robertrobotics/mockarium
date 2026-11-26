using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mockarium.Core;
using Mockarium.Core.Mcp;
using Mockarium.Core.Storage;

namespace Mockarium.ViewModels;

public sealed partial class DatabaseStudioViewModel : StudioViewModel
{
    private string? _savedModel;
    private string? _editingRecordId;
    private DatabaseRecord? _editingRecord;
    private bool _loading;
    private bool _changingTable;
    private bool _changingRecord;
    private (string Name, string Value)[] _savedRecordFields = [];

    [ObservableProperty] private TableEditorViewModel? selectedTable;
    [ObservableProperty] private FieldEditorViewModel? selectedField;
    [ObservableProperty] private DatabaseRecord? selectedRecord;

    public DatabaseStudioViewModel(DesktopViewModel shell, MockariumStore store, McpRuntime runtime, IPlatformServices platform)
        : base(shell, store, runtime, platform, "database", "Database Studio",
            "Shape relational data your agent can explore and change.", "▦") { }

    public ObservableCollection<TableEditorViewModel> Tables { get; } = [];
    public override StarterGuide Starter { get; } = new("Explore a connected dataset",
        "Start with linked tables and sample records. You can edit both the rows and the model.",
        "Choose a table and open a record. Use Model designer when you want to change its fields.");
    public ObservableCollection<DatabaseRecord> Records { get; } = [];
    public ObservableCollection<RecordFieldViewModel> RecordFields { get; } = [];
    public IReadOnlyList<string> FieldTypes { get; } = ["text", "email", "number", "boolean", "date", "relation"];
    private bool RecordHasChanges =>
        !RecordFields.Select(item => (item.Name, item.Value)).SequenceEqual(_savedRecordFields);
    internal override bool HasUnsavedChanges => IsConfigured && (ModelHasChanges() || RecordHasChanges);

    protected override void LoadData()
    {
        _loading = true;
        try
        {
            Tables.Clear();
            Records.Clear();
            RecordFields.Clear();
            SelectedTable = null;
            SelectedField = null;
            SelectedRecord = null;
            _editingRecordId = null;
            _editingRecord = null;
            _savedRecordFields = [];
            _savedModel = null;
            if (!HasWorkspace || !IsConfigured) return;
            var model = Store.GetDatabaseModel(WorkspaceId)
                ?? throw new InvalidOperationException("The simulated database model is missing.");
            _savedModel = MockariumJson.Serialize(model);
            foreach (var table in model.Tables) Tables.Add(new TableEditorViewModel(table));
            SelectedTable = Tables.FirstOrDefault();
            SelectedField = SelectedTable?.Fields.FirstOrDefault();
        }
        finally
        {
            _loading = false;
        }
        RefreshRecords();
        ResetRecord();
    }

    protected override void ResetData() => Store.ResetDatabase(WorkspaceId);

    internal override void OnAgentExecution(ExecutionEvent entry)
    {
        if (entry.ToolName is not ("database_create_record" or "database_update_record" or "database_delete_record") ||
            SelectedTable is null || !entry.Input.TryGetProperty("table", out var table) ||
            table.GetString() != SelectedTable.Name)
            return;
        var selectedId = _editingRecordId;
        _loading = true;
        try
        {
            RefreshRecords();
            SelectedRecord = Records.FirstOrDefault(record => record.Id == selectedId);
        }
        finally
        {
            _loading = false;
        }
        if (selectedId is not null && entry.Input.TryGetProperty("id", out var id) && id.GetString() == selectedId)
            Shell.Notice = "An agent changed the record you are editing. Refresh or reselect it before saving.";
    }

    protected override void BeforeToggleServer()
    {
        if (IsConfigured && ModelHasChanges())
            throw new InvalidOperationException("Save or discard database model changes before starting or stopping its server.");
    }

    partial void OnSelectedTableChanged(TableEditorViewModel? oldValue, TableEditorViewModel? newValue)
    {
        if (_loading) return;
        if (RecordHasChanges || _changingTable)
        {
            _loading = true;
            try { SelectedTable = oldValue; }
            finally { _loading = false; }
            if (!_changingTable) _ = SelectTableAsync(newValue);
            return;
        }
        ApplyTable(newValue);
    }

    private async Task SelectTableAsync(TableEditorViewModel? table)
    {
        _changingTable = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(RecordHasChanges, "record changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                if (table is not null && !Tables.Contains(table))
                    throw new InvalidOperationException("The selected table is no longer available.");
                _loading = true;
                try { SelectedTable = table; }
                finally { _loading = false; }
                ApplyTable(table);
            });
        }
        finally { _changingTable = false; }
    }

    private void ApplyTable(TableEditorViewModel? table)
    {
        SelectedField = table?.Fields.FirstOrDefault();
        if (!HasWorkspace || !IsConfigured) return;
        Shell.Run(() =>
        {
            RefreshRecords();
            ResetRecord();
        });
    }

    partial void OnSelectedRecordChanged(DatabaseRecord? value)
    {
        if (value is null || _loading) return;
        if (RecordHasChanges || _changingRecord)
        {
            _loading = true;
            try { SelectedRecord = Records.FirstOrDefault(record => record.Id == _editingRecordId); }
            finally { _loading = false; }
            if (!_changingRecord) _ = SelectRecordAsync(value);
            return;
        }
        ApplyRecord(value);
    }

    private async Task SelectRecordAsync(DatabaseRecord record)
    {
        _changingRecord = true;
        var workspaceId = WorkspaceId;
        try
        {
            await Shell.RunAsync(async () =>
            {
                if (!await ConfirmDiscardAsync(RecordHasChanges, "record changes") ||
                    !HasWorkspace || WorkspaceId != workspaceId) return;
                var selected = Records.FirstOrDefault(item => item.Id == record.Id)
                    ?? throw new InvalidOperationException("The selected record is no longer available.");
                _loading = true;
                try { SelectedRecord = selected; }
                finally { _loading = false; }
                ApplyRecord(selected);
            });
        }
        finally { _changingRecord = false; }
    }

    private void ApplyRecord(DatabaseRecord value)
    {
        _editingRecordId = value.Id;
        _editingRecord = value;
        PopulateRecordFields(value);
    }

    [RelayCommand]
    private Task RefreshAsync() => RefreshDataAsync();

    [RelayCommand]
    private void AddTable() => Shell.Run(() =>
    {
        if (!IsConfigured) throw new InvalidOperationException("Create the starter database first.");
        var index = 1;
        while (Tables.Any(table => table.Name == $"table_{index}")) index++;
        var name = $"table_{index}";
        var table = new TableEditorViewModel(new DatabaseTable(name, name, $"Table {index}",
            [new DatabaseField($"{name}_name", "name", "Name", "text", true)]));
        Tables.Add(table);
        SelectedTable = table;
    });

    [RelayCommand]
    private async Task RemoveTableAsync() => await Shell.RunAsync(async () =>
    {
        var table = SelectedTable ?? throw new InvalidOperationException("Select a table first.");
        var workspaceId = WorkspaceId;
        if (!await ConfirmDiscardAsync(RecordHasChanges, "record changes") ||
            !HasWorkspace || WorkspaceId != workspaceId) return;
        if (!Tables.Contains(table) || SelectedTable != table)
            throw new InvalidOperationException("The selected table is no longer available.");
        _loading = true;
        try
        {
            Tables.Remove(table);
            SelectedTable = Tables.FirstOrDefault();
        }
        finally { _loading = false; }
        ApplyTable(SelectedTable);
    });

    [RelayCommand]
    private void AddField() => Shell.Run(() =>
    {
        var table = SelectedTable ?? throw new InvalidOperationException("Select a table first.");
        var index = 1;
        while (table.Fields.Any(field => field.Name == $"field_{index}")) index++;
        var field = new FieldEditorViewModel(new DatabaseField(Guid.NewGuid().ToString(), $"field_{index}", $"Field {index}", "text", false));
        table.Fields.Add(field);
        SelectedField = field;
    });

    [RelayCommand]
    private void RemoveField() => Shell.Run(() =>
    {
        var table = SelectedTable ?? throw new InvalidOperationException("Select a table first.");
        var field = SelectedField ?? throw new InvalidOperationException("Select a field first.");
        table.Fields.Remove(field);
        SelectedField = table.Fields.FirstOrDefault();
    });

    [RelayCommand]
    private async Task SaveModelAsync() => await Shell.RunAsync(async () =>
    {
        if (!await ConfirmDiscardAsync(RecordHasChanges, "record changes")) return;
        var model = BuildModel();
        var existing = Store.GetDatabaseModel(WorkspaceId)
            ?? throw new InvalidOperationException("The simulated database model is missing.");
        var removesValues = existing.Tables.Any(oldTable =>
        {
            var nextTable = model.Tables.FirstOrDefault(table => table.Name == oldTable.Name);
            if (nextTable is null) return false;
            var removedFields = oldTable.Fields.Select(item => item.Name)
                .Except(nextTable.Fields.Select(item => item.Name), StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
            return removedFields.Count > 0 && Store.GetDatabaseRecords(WorkspaceId, oldTable.Name)
                .Any(record => record.Values.Keys.Any(removedFields.Contains));
        });
        if (removesValues && !await Platform.ConfirmAsync("Remove field data",
            "Saving this model permanently removes values from existing records. Continue?")) return;
        var selectedId = SelectedTable?.Id;
        Store.SaveDatabaseModel(WorkspaceId, model);
        LoadData();
        SelectedTable = Tables.FirstOrDefault(table => table.Id == selectedId) ?? Tables.FirstOrDefault();
        Shell.Notice = "Database model saved.";
    });

    [RelayCommand]
    private async Task NewRecordAsync() => await Shell.RunAsync(async () =>
    {
        if (await ConfirmDiscardAsync(RecordHasChanges, "record changes")) ResetRecord();
    });

    private void ResetRecord()
    {
        _editingRecordId = null;
        _editingRecord = null;
        SelectedRecord = null;
        PopulateRecordFields(null);
    }

    [RelayCommand]
    private void SaveRecord() => Shell.Run(() =>
    {
        if (ModelHasChanges()) throw new InvalidOperationException("Save the database model before editing records.");
        var table = SelectedTable ?? throw new InvalidOperationException("Select a table first.");
        var values = RecordFields.ToDictionary(field => field.Name, field => field.ToJson(), StringComparer.Ordinal);
        var saved = Store.SaveDatabaseRecord(WorkspaceId, table.Name, _editingRecordId, values, _editingRecord);
        RefreshRecords();
        _loading = true;
        try { SelectedRecord = Records.FirstOrDefault(record => record.Id == saved.Id); }
        finally { _loading = false; }
        ApplyRecord(saved);
        Shell.Notice = "Record saved.";
    });

    [RelayCommand]
    private async Task DeleteRecordAsync() => await Shell.RunAsync(async () =>
    {
        if (ModelHasChanges()) throw new InvalidOperationException("Save the database model before editing records.");
        var table = SelectedTable ?? throw new InvalidOperationException("Select a table first.");
        var id = _editingRecordId ?? throw new InvalidOperationException("Select a record first.");
        var workspaceId = WorkspaceId;
        var hasChanges = RecordHasChanges;
        if (!await Platform.ConfirmAsync("Delete record",
            $"Permanently delete this record{(hasChanges ? " and discard its unsaved changes" : "")}? This cannot be undone."))
            return;
        if (!HasWorkspace || WorkspaceId != workspaceId || SelectedTable != table || _editingRecordId != id)
            return;
        Store.DeleteDatabaseRecord(WorkspaceId, table.Name, id, _editingRecord);
        RefreshRecords();
        ResetRecord();
        Shell.Notice = "Record deleted.";
    });

    private void RefreshRecords()
    {
        Records.Clear();
        var table = SelectedTable;
        if (table is null || !HasWorkspace || !IsConfigured) return;
        var storedModel = Store.GetDatabaseModel(WorkspaceId);
        if (storedModel is null || !storedModel.Tables.Any(candidate => candidate.Name == table.Name)) return;
        foreach (var record in Store.GetDatabaseRecords(WorkspaceId, table.Name)) Records.Add(record);
    }

    private void PopulateRecordFields(DatabaseRecord? record)
    {
        RecordFields.Clear();
        if (SelectedTable is null)
        {
            _savedRecordFields = [];
            return;
        }
        foreach (var field in SelectedTable.Fields)
        {
            JsonElement? value = record is not null && record.Values.TryGetValue(field.Name, out var stored)
                ? stored : null;
            RecordFields.Add(new RecordFieldViewModel(field, value));
        }
        _savedRecordFields = RecordFields.Select(field => (field.Name, field.Value)).ToArray();
    }

    private DatabaseModel BuildModel() => new(Tables.Select(table => table.ToModel()).ToArray());
    private bool ModelHasChanges() => _savedModel is not null && MockariumJson.Serialize(BuildModel()) != _savedModel;
}

public sealed partial class TableEditorViewModel : ObservableObject
{
    public TableEditorViewModel(DatabaseTable table)
    {
        Id = table.Id;
        name = table.Name;
        label = table.Label;
        foreach (var field in table.Fields) Fields.Add(new FieldEditorViewModel(field));
    }

    public string Id { get; }
    [ObservableProperty] private string name;
    [ObservableProperty] private string label;
    public ObservableCollection<FieldEditorViewModel> Fields { get; } = [];
    public DatabaseTable ToModel() => new(Id, Name, Label, Fields.Select(field => field.ToModel()).ToArray());
}

public sealed partial class FieldEditorViewModel : ObservableObject
{
    public FieldEditorViewModel(DatabaseField field)
    {
        Id = field.Id;
        name = field.Name;
        label = field.Label;
        type = field.Type;
        required = field.Required;
        relationTo = field.RelationTo ?? "";
    }

    public string Id { get; }
    [ObservableProperty] private string name;
    [ObservableProperty] private string label;
    [ObservableProperty] private string type;
    [ObservableProperty] private bool required;
    [ObservableProperty] private string relationTo;
    public DatabaseField ToModel() =>
        new(Id, Name, Label, Type, Required, Type == "relation" && !string.IsNullOrWhiteSpace(RelationTo) ? RelationTo.Trim() : null);
}

public sealed partial class RecordFieldViewModel : ObservableObject
{
    public RecordFieldViewModel(FieldEditorViewModel field, JsonElement? value)
    {
        Name = field.Name;
        Label = field.Label;
        Type = field.Type;
        Required = field.Required;
        Value = value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" :
            value.Value.ValueKind == JsonValueKind.String ? value.Value.GetString() ?? "" : value.Value.GetRawText();
    }

    public string Name { get; }
    public string Label { get; }
    public string Type { get; }
    public bool Required { get; }
    public string Hint => Type == "relation" ? "Record ID" : Type == "boolean" ? "true or false" : Type;
    [ObservableProperty] private string value;

    public JsonElement ToJson()
    {
        if (string.IsNullOrEmpty(Value) && !Required) return MockariumJson.Element<object?>(null);
        return Type switch
        {
            "number" when double.TryParse(Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number)
                => MockariumJson.Element(number),
            "number" => throw new ArgumentException($"The \"{Label}\" field must be a number."),
            "boolean" when bool.TryParse(Value, out var boolean) => MockariumJson.Element(boolean),
            "boolean" => throw new ArgumentException($"The \"{Label}\" field must be true or false."),
            _ => MockariumJson.Element(Value)
        };
    }
}
