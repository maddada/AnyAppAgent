import { memo, useMemo } from "react";
import { Linking, ScrollView, Text, View, type TextStyle } from "react-native";
import { parseMarkdown, type Block, type Inline, type ListItem } from "@shared/chat/index";
import { fonts, radius, space, typeStyle, useTheme, type Colors, border } from "@/ui/theme";

/**
 * Markdown in bb's style (apps/app/src/components/ui/markdown-preview.tsx): plain prose,
 * semibold headings, links underlined in the text colour, mono inline code on a muted chip,
 * code blocks on a recessed card. The parsing is shared with the desktop (shared/chat/markdown.ts):
 * this file only draws its blocks.
 */
export const Markdown = memo(function Markdown({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  // Assistant text: type.prose in ink; paragraphs and lists gap space.md (COMPONENTS.md, Assistant message).
  const base: TextStyle = { ...typeStyle("prose"), color: color ?? t.text };
  return <View>{renderBlocks(blocks, t, base)}</View>;
});

function renderBlocks(blocks: Block[], t: Colors, base: TextStyle, gap: number = space.md) {
  return blocks.map((b, i) => <BlockView key={i} block={b} t={t} base={base} first={i === 0} mb={i === blocks.length - 1 ? 0 : gap} />);
}

function BlockView({ block, t, base, first, mb }: { block: Block; t: Colors; base: TextStyle; first: boolean; mb: number }) {
  switch (block.type) {
    case "paragraph":
      return (
        <Text style={[base, { marginBottom: mb }]} selectable>
          {renderInline(block.inline, t, base)}
        </Text>
      );
    case "heading":
      // Headings inside a message render as type.heading.
      return (
        <Text style={[base, typeStyle("heading"), { color: base.color, marginTop: first ? 0 : space.sm, marginBottom: mb ? space.sm : 0 }]} selectable>
          {renderInline(block.inline, t, base)}
        </Text>
      );
    case "list":
      return (
        <View style={{ marginBottom: mb }}>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: i === block.items.length - 1 ? 0 : block.tight ? space.xs : space.sm }}>
              <Text style={[base, { width: space.xl, color: t.textTertiary }]}>{marker(block.ordered, block.start + i, item)}</Text>
              <View style={{ flex: 1 }}>{renderBlocks(item.blocks, t, base, block.tight ? space.xs : space.sm)}</View>
            </View>
          ))}
        </View>
      );
    case "code":
      // Code blocks: type.mono on codeBg, radius.badge, padding space.md, scroll sideways, never wrap.
      return (
        <View style={{ marginBottom: mb, borderRadius: radius.badge, backgroundColor: t.codeBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={{ ...typeStyle("mono"), color: t.text, padding: space.md }}>
              {block.text}
            </Text>
          </ScrollView>
        </View>
      );
    case "quote":
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: t.border, paddingLeft: space.md, marginBottom: mb }}>
          {renderBlocks(block.blocks, t, { ...base, color: t.textSecondary })}
        </View>
      );
    case "rule":
      return <View style={{ height: border.width, backgroundColor: t.border, marginTop: space.xs, marginBottom: mb || space.xs }} />;
    case "table":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: mb }}>
          <View style={{ borderWidth: border.width, borderColor: t.border, borderRadius: radius.badge, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", backgroundColor: t.codeBg }}>
              {block.header.map((cell, i) => (
                <Text key={i} style={[base, cellStyle(t, i), { fontFamily: fonts.strong, textAlign: block.align[i] ?? "left" }]}>
                  {renderInline(cell, t, base)}
                </Text>
              ))}
            </View>
            {block.rows.map((row, r) => (
              <View key={r} style={{ flexDirection: "row" }}>
                {row.map((cell, i) => (
                  <Text key={i} style={[base, cellStyle(t, i), { textAlign: block.align[i] ?? "left" }]} selectable>
                    {renderInline(cell, t, base)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

function marker(ordered: boolean, n: number, item: ListItem): string {
  if (ordered) return `${n}.`;
  if (item.task) return item.checked ? "☑" : "☐";
  return "•";
}

function cellStyle(t: Colors, column: number): TextStyle {
  return {
    minWidth: space["7xl"],
    maxWidth: space["7xl"] * 3,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderLeftWidth: column === 0 ? 0 : border.width,
    borderTopWidth: border.width,
    borderColor: t.border,
  };
}

function renderInline(nodes: Inline[], t: Colors, base: TextStyle): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "br":
        return "\n";
      case "strong":
        return (
          <Text key={i} style={{ fontFamily: fonts.strong }}>
            {renderInline(n.children, t, base)}
          </Text>
        );
      case "em":
        return (
          <Text key={i} style={{ fontStyle: "italic" }}>
            {renderInline(n.children, t, base)}
          </Text>
        );
      case "del":
        return (
          <Text key={i} style={{ textDecorationLine: "line-through" }}>
            {renderInline(n.children, t, base)}
          </Text>
        );
      case "code":
        // Inline code: type.mono at 0.86em on codeBg (RN can't round inline spans).
        return (
          <Text key={i} style={{ fontFamily: fonts.mono, fontSize: (base.fontSize ?? 0) * 0.86, backgroundColor: t.codeBg }}>
            {` ${n.text} `}
          </Text>
        );
      case "link":
        return (
          <Text
            key={i}
            accessibilityRole="link"
            style={{ textDecorationLine: "underline", textDecorationColor: t.borderStrong }}
            onPress={() => void Linking.openURL(n.href).catch(() => undefined)}
          >
            {renderInline(n.children, t, base)}
          </Text>
        );
    }
  });
}
