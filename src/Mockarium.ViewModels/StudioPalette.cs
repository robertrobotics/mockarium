namespace Mockarium.ViewModels;

/// <summary>Semantic color pairs shared by both desktop renderers, including the week planner.</summary>
public static class StudioPalette
{
    public static IReadOnlyList<(string Key, string Day, string Night)> Brushes { get; } =
        Array.AsReadOnly<(string, string, string)>(
        [
            ("CanvasBrush",      "#F4F4EE", "#101B1E"),
            ("SurfaceBrush",     "#FFFEFA", "#1C2A2E"),
            ("SubtleBrush",      "#EAEEE7", "#233438"),
            ("InkBrush",         "#16322F", "#F0F6F2"),
            ("MutedBrush",       "#4C615D", "#B1C5BD"),
            ("BorderBrush",      "#CBD7CE", "#415854"),
            ("AccentBrush",      "#006A5B", "#78E2C4"),
            ("OnAccentBrush",    "#FFFFFF", "#092F29"),
            ("AccentSoftBrush",  "#D8EFE3", "#1B453C"),
            ("SecondaryBrush",   "#574592", "#D3C1FF"),
            ("SecondarySoftBrush","#EBE7FA", "#3C344F"),
            ("WarmBrush",        "#87411E", "#FFC497"),
            ("WarmSoftBrush",    "#F9E7D4", "#49362A"),
            ("PositiveBrush",    "#22624C", "#94E6BB"),
            ("PositiveSoftBrush","#DFF3E5", "#203E32"),
            ("DangerBrush",      "#992E42", "#FFADB9"),
            ("DangerSoftBrush",  "#FCE5E8", "#492B36"),
            ("SidebarBrush",     "#122E30", "#0B191C")
        ]);
}
