// The agent's messages on the desktop: the shared parser (shared/chat/markdown.ts, the same one the
// phone uses) drawn as DOM. Never HTML from the agent: every piece is a React text node, and links
// open in the default browser through the main process.
import { memo, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "../../../../shared/chat/index.ts";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="prose">{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
});

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p>{inline(block.inline)}</p>;
    case "heading":
      return <p className="md-h">{inline(block.inline)}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={block.tight ? "tight" : undefined} start={block.ordered && block.start !== 1 ? block.start : undefined}>
          {block.items.map((item, i) => (
            <li key={i} className={item.task ? "task" : undefined}>
              {item.task && <span className="md-box" aria-label={item.checked ? "Done" : "Not done"}>{item.checked ? "☑" : "☐"}</span>}
              {item.blocks.map((b, j) => <BlockView key={j} block={b} />)}
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </blockquote>
      );
    case "rule":
      return <hr />;
    case "table":
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {block.header.map((c, i) => (
                  <th key={i} style={{ textAlign: block.align[i] ?? "left" }}>
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} style={{ textAlign: block.align[i] ?? "left" }}>
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "br":
        return <br key={i} />;
      case "strong":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "em":
        return <em key={i}>{inline(n.children)}</em>;
      case "del":
        return <del key={i}>{inline(n.children)}</del>;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "link":
        return (
          <a
            key={i}
            href={n.href}
            title={n.href}
            onClick={(e) => {
              e.preventDefault();
              void window.anyapp.openExternal(n.href);
            }}
          >
            {inline(n.children)}
          </a>
        );
    }
  });
}
