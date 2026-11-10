import { memo, useMemo } from "react";
import { Linking, ScrollView, Text, View, type TextStyle } from "react-native";
import { marked, type Token, type Tokens } from "marked";
import { fonts, radius, space, typeStyle, useTheme, type Colors, border } from "@/ui/theme";

/**
 * Markdown in bb's style (apps/app/src/components/ui/markdown-preview.tsx): plain prose,
 * semibold headings, links underlined in the text colour, mono inline code on a muted chip,
 * code blocks in a bordered recessed card with a language label.
 */
export const Markdown = memo(function Markdown({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  const tokens = useMemo(() => {
    try {
      return marked.lexer(text, { gfm: true, breaks: false });
    } catch {
      return [{ type: "paragraph", raw: text, text, tokens: [{ type: "text", raw: text, text }] }] as Token[];
    }
  }, [text]);
  // Assistant text: type.prose in ink; paragraphs and lists gap space.md (COMPONENTS.md, Assistant message).
  const base: TextStyle = { ...typeStyle("prose"), color: color ?? t.text };
  return <View>{renderBlocks(tokens, t, base)}</View>;
});

function renderBlocks(tokens: Token[], t: Colors, base: TextStyle) {
  const out: React.ReactNode[] = [];
  const blocks = tokens.filter((tk) => tk.type !== "space");
  blocks.forEach((tk, i) => {
    const first = i === 0;
    const last = i === blocks.length - 1;
    out.push(<Block key={i} token={tk} t={t} base={base} first={first} last={last} />);
  });
  return out;
}

function Block({ token, t, base, first, last }: { token: Token; t: Colors; base: TextStyle; first: boolean; last: boolean }) {
  const mb = last ? 0 : space.md;
  switch (token.type) {
    case "paragraph": {
      const p = token as Tokens.Paragraph;
      return (
        <Text style={[base, { marginBottom: mb }]} selectable>
          {renderInline(p.tokens, t, base)}
        </Text>
      );
    }
    case "heading": {
      // Headings inside a message render as type.heading.
      const h = token as Tokens.Heading;
      return (
        <Text style={[base, typeStyle("heading"), { color: base.color, marginTop: first ? 0 : space.sm, marginBottom: last ? 0 : space.sm }]}>
          {renderInline(h.tokens, t, base)}
        </Text>
      );
    }
    case "list": {
      const l = token as Tokens.List;
      const start = typeof l.start === "number" ? l.start : 1;
      return (
        <View style={{ marginBottom: mb }}>
          {l.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: i === l.items.length - 1 ? 0 : space.xs }}>
              <Text style={[base, { width: space.xl, color: t.textTertiary }]}>{l.ordered ? `${start + i}.` : item.task ? (item.checked ? "☑" : "☐") : "•"}</Text>
              <View style={{ flex: 1 }}>{renderListItem(item, t, base)}</View>
            </View>
          ))}
        </View>
      );
    }
    case "code": {
      const c = token as Tokens.Code;
      return <CodeBlock code={c.text} lang={c.lang} t={t} mb={last ? 0 : 8} mt={first ? 0 : 0} />;
    }
    case "blockquote": {
      const q = token as Tokens.Blockquote;
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: t.border, paddingLeft: space.md, marginBottom: mb }}>
          {renderBlocks(q.tokens, t, { ...base, color: t.textSecondary })}
        </View>
      );
    }
    case "hr":
      return <View style={{ height: border.width, backgroundColor: t.border, marginVertical: space.md }} />;
    case "table": {
      const tb = token as Tokens.Table;
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: mb }}>
          <View style={{ borderWidth: border.width, borderColor: t.border, borderRadius: radius.badge, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", backgroundColor: t.codeBg }}>
              {tb.header.map((cell, i) => (
                <Text key={i} style={[base, cellStyle(t), { fontFamily: fonts.strong }]}>
                  {renderInline(cell.tokens, t, base)}
                </Text>
              ))}
            </View>
            {tb.rows.map((row, r) => (
              <View key={r} style={{ flexDirection: "row" }}>
                {row.map((cell, i) => (
                  <Text key={i} style={[base, cellStyle(t)]}>
                    {renderInline(cell.tokens, t, base)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
    case "html":
    case "text": {
      const tx = token as Tokens.Text;
      return (
        <Text style={[base, { marginBottom: mb }]} selectable>
          {tx.tokens ? renderInline(tx.tokens, t, base) : tx.text}
        </Text>
      );
    }
    default:
      return "raw" in token && token.raw.trim() ? <Text style={[base, { marginBottom: mb }]}>{token.raw.trim()}</Text> : null;
  }
}

function cellStyle(t: Colors): TextStyle {
  return { minWidth: space["7xl"], maxWidth: space["7xl"] * 3, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRightWidth: 1, borderTopWidth: 1, borderColor: t.border };
}

function renderListItem(item: Tokens.ListItem, t: Colors, base: TextStyle) {
  // Tight lists hold "text" tokens with inline children; loose ones hold paragraphs.
  return item.tokens.filter((tk) => tk.type !== "space" && tk.type !== "checkbox").map((tk, i, all) => {
    if (tk.type === "text") {
      const tx = tk as Tokens.Text;
      return (
        <Text key={i} style={base} selectable>
          {tx.tokens ? renderInline(tx.tokens, t, base) : tx.text}
        </Text>
      );
    }
    return <Block key={i} token={tk} t={t} base={base} first={i === 0} last={i === all.length - 1} />;
  });
}

function renderInline(tokens: Token[] | undefined, t: Colors, base: TextStyle): React.ReactNode[] {
  if (!tokens) return [];
  return tokens.map((tk, i) => {
    switch (tk.type) {
      case "strong":
        return (
          <Text key={i} style={{ fontFamily: fonts.strong }}>
            {renderInline((tk as Tokens.Strong).tokens, t, base)}
          </Text>
        );
      case "em":
        return (
          <Text key={i} style={{ fontStyle: "italic" }}>
            {renderInline((tk as Tokens.Em).tokens, t, base)}
          </Text>
        );
      case "del":
        return (
          <Text key={i} style={{ textDecorationLine: "line-through" }}>
            {renderInline((tk as Tokens.Del).tokens, t, base)}
          </Text>
        );
      case "codespan":
        return (
          // Inline code: type.mono at 0.86em on codeBg (RN can't round inline spans).
          <Text key={i} style={{ fontFamily: fonts.mono, fontSize: (base.fontSize ?? 0) * 0.86, backgroundColor: t.codeBg }}>
            {` ${decode((tk as Tokens.Codespan).text)} `}
          </Text>
        );
      case "link": {
        const l = tk as Tokens.Link;
        return (
          <Text key={i} style={{ textDecorationLine: "underline", textDecorationColor: t.borderStrong }} onPress={() => void Linking.openURL(l.href).catch(() => undefined)}>
            {renderInline(l.tokens, t, base)}
          </Text>
        );
      }
      case "br":
        return "\n";
      case "image":
        return (tk as Tokens.Image).text;
      case "escape":
        return (tk as Tokens.Escape).text;
      case "text": {
        const tx = tk as Tokens.Text;
        return tx.tokens ? <Text key={i}>{renderInline(tx.tokens, t, base)}</Text> : decode(tx.text);
      }
      default:
        return "text" in tk ? decode(String((tk as { text: string }).text)) : "raw" in tk ? tk.raw : "";
    }
  });
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function CodeBlock({ code, lang, t, mb, mt }: { code: string; lang?: string; t: Colors; mb: number; mt: number }) {
  // Code blocks: type.mono on codeBg, radius.badge, padding space.md, scroll sideways, never wrap.
  void lang;
  return (
    <View style={{ marginTop: mt, marginBottom: mb, borderRadius: radius.badge, backgroundColor: t.codeBg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={{ ...typeStyle("mono"), color: t.text, padding: space.md }}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}
