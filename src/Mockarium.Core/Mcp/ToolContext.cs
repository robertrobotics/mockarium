using System.Diagnostics;
using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Mockarium.Core.Storage;

namespace Mockarium.Core.Mcp;

internal sealed class ToolContext(
    MockariumStore store,
    string workspaceId,
    string serverName,
    Action<ExecutionEvent> publish,
    ILogger logger)
{
    public MockariumStore Store { get; } = store;
    public string WorkspaceId { get; } = workspaceId;

    public CallToolResult Execute(string name, object input, Func<object?> handler)
    {
        var stopwatch = Stopwatch.StartNew();
        object? output;
        string? error = null;
        try
        {
            output = handler();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Mock tool {ToolName} failed in workspace {WorkspaceId}", name, WorkspaceId);
            error = exception is ArgumentException or InvalidOperationException
                ? exception.Message
                : "The mock operation failed. See the application log for details.";
            output = new { error };
        }

        var entry = Store.RecordEvent(
            WorkspaceId, serverName, name, MockariumJson.Element(input), MockariumJson.Element(output),
            (int)Math.Min(int.MaxValue, stopwatch.ElapsedMilliseconds), error);
        try
        {
            publish(entry);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Could not publish execution event {ExecutionId}", entry.Id);
        }

        return new CallToolResult
        {
            Content = [new TextContentBlock { Text = System.Text.Json.JsonSerializer.Serialize(output, MockariumJson.IndentedOptions) }],
            StructuredContent = MockariumJson.Element(new { data = output }),
            IsError = error is not null
        };
    }

    public static IReadOnlyList<McpServerTool> CreateTools(object target) =>
        target.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .Where(method => method.GetCustomAttribute<McpServerToolAttribute>() is not null)
            .Select(method => McpServerTool.Create(method, target, new McpServerToolCreateOptions
            {
                SerializerOptions = MockariumJson.Options,
                SchemaCreateOptions = new AIJsonSchemaCreateOptions
                {
                    TransformSchemaNode = static (_, schema) =>
                    {
                        if (schema is JsonObject node &&
                            node["type"] is JsonArray types &&
                            !node.ContainsKey("anyOf"))
                        {
                            var branches = new JsonArray();
                            foreach (var type in types)
                                branches.Add(new JsonObject { ["type"] = type?.DeepClone() });
                            node.Remove("type");
                            node["anyOf"] = branches;
                        }
                        return schema;
                    }
                }
            }))
            .ToArray();
}
