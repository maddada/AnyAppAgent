import { memo, useMemo } from "react";
import { Linking, ScrollView, Text, View, type TextStyle } from "react-native";
import { marked, type Token, type Tokens } from "marked";
import { font, radius, useTheme, type Theme, space } from "@/ui/theme";

/**
 * Markdown in bb's style (apps/app/src/components/ui/markdown-preview.tsx): plain prose,
 * semibold headings, links underlined in the text colour, mono inline code on a muted chip,
 * code blocks in a bordered recessed card with a language label.
 */
export const Markdown = memo(function Markdown({ text, color, size = 15 }: { text: string; color?: string; size?: number }) {
  const t = useTheme();
  const tokens = useMemo(() => {
    try {
      return marked.lexer(text, { gfm: true, breaks: false });
    } catch {
      return [{ type: "paragraph", raw: text, text, tokens: [{ type: "text", raw: text, text }] }] as Token[];
    }
  }, [text]);
  const base: TextStyle = { fontSize: size, lineHeight: Math.round(size * 1.6), color: color ?? t.foreground, fontFamily: font.regular };
  return <View>{renderBlocks(tokens, t, base)}</View>;
});

function renderBlocks(tokens: Token[], t: Theme, base: TextStyle) {
  const out: React.ReactNode[] = [];
  const blocks = tokens.filter((tk) => tk.type !== "space");
  blocks.forEach((tk, i) => {
    const first = i === 0;
    const last = i === blocks.length - 1;
    out.push(<Block key={i} token={tk} t={t} base={base} first={first} last={last} />);
  });
  return out;
}

function Block({ token, t, base, first, last }: { token: Token; t: Theme; base: TextStyle; first: boolean; last: boolean }) {
  const mb = last ? 0 : 8;
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
      const h = token as Tokens.Heading;
      const sizes = [20, 17, 15, 15, 14, 13];
      const fontSize = sizes[h.depth - 1] ?? 15;
      const small = h.depth >= 5;
      return (
        <Text
          style={[
            base,
            {
              fontSize,
              lineHeight: Math.round(fontSize * 1.4),
              fontFamily: h.depth === 4 ? font.medium : font.semibold,
              color: small ? t.mutedForeground : base.color,
              textTransform: small ? "uppercase" : "none",
              marginTop: first ? 0 : h.depth <= 2 ? 16 : 12,
              marginBottom: last ? 0 : h.depth >= 4 ? 4 : 8,
            },
          ]}
        >
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
            <View key={i} style={{ flexDirection: "row", marginBottom: i === l.items.length - 1 ? 0 : 4 }}>
              <Text style={[base, { width: 22, color: t.mutedForeground }]}>{l.ordered ? `${start + i}.` : item.task ? (item.checked ? "☑" : "☐") : "•"}</Text>
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
        <View style={{ borderLeftWidth: 2, borderLeftColor: t.quoteBorder, paddingLeft: space.md, marginVertical: space.sm }}>
          {renderBlocks(q.tokens, t, { ...base, color: t.mutedForeground })}
        </View>
      );
    }
    case "hr":
      return <View style={{ height: 1, backgroundColor: t.border, marginVertical: space.lg }} />;
    case "table": {
      const tb = token as Tokens.Table;
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: mb }}>
          <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", backgroundColor: t.recessed }}>
              {tb.header.map((cell, i) => (
                <Text key={i} style={[base, cellStyle(t), { fontFamily: font.medium }]}>
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

function cellStyle(t: Theme): TextStyle {
  return { minWidth: 90, maxWidth: 220, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRightWidth: 1, borderTopWidth: 1, borderColor: t.border };
}

function renderListItem(item: Tokens.ListItem, t: Theme, base: TextStyle) {
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

function renderInline(tokens: Token[] | undefined, t: Theme, base: TextStyle): React.ReactNode[] {
  if (!tokens) return [];
  return tokens.map((tk, i) => {
    switch (tk.type) {
      case "strong":
        return (
          <Text key={i} style={{ fontFamily: font.semibold }}>
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
          <Text key={i} style={{ fontFamily: font.mono, fontSize: (base.fontSize ?? 15) - 2, backgroundColor: t.inlineCode }}>
            {` ${decode((tk as Tokens.Codespan).text)} `}
          </Text>
        );
      case "link": {
        const l = tk as Tokens.Link;
        return (
          <Text key={i} style={{ textDecorationLine: "underline" }} onPress={() => void Linking.openURL(l.href).catch(() => undefined)}>
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

function CodeBlock({ code, lang, t, mb, mt }: { code: string; lang?: string; t: Theme; mb: number; mt: number }) {
  return (
    <View style={{ marginTop: mt, marginBottom: mb, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.recessed }}>
      {lang ? (
        <Text style={{ fontFamily: font.mono, fontSize: 12, color: t.mutedForeground, textTransform: "uppercase", paddingLeft: space.md, paddingTop: space.sm }}>{lang}</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: 18, color: t.foreground, paddingHorizontal: space.md, paddingTop: lang ? 4 : 10, paddingBottom: space.sm }}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}
