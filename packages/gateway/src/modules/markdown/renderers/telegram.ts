/**
 * IR -> Telegram MarkdownV2 renderer.
 *
 * Telegram MarkdownV2 requires escaping special characters outside of code blocks.
 */

import type { IrNode } from "../parser.js";

const TELEGRAM_SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

function escapeTelegram(text: string): string {
  return text.replace(TELEGRAM_SPECIAL_CHARS, "\\$1");
}

export function renderTelegram(nodes: IrNode[]): string {
  return nodes.map(renderNode).join("\n\n");
}

function renderNode(node: IrNode): string {
  switch (node.kind) {
    case "heading":
      return `*${renderChildren(node.children)}*`;

    case "paragraph":
      return renderChildren(node.children);

    case "code_block": {
      const lang = node.language ?? "";
      return `\`\`\`${lang}\n${node.content ?? ""}\n\`\`\``;
    }

    case "list":
      return (node.children ?? [])
        .map((item, i) => {
          const prefix = node.ordered ? `${String(i + 1)}\\.` : "\u2022";
          return `${prefix} ${renderChildren(item.children)}`;
        })
        .join("\n");

    case "horizontal_rule":
      return "\u2014\u2014\u2014";

    case "text":
      return escapeTelegram(node.content ?? "");

    case "bold":
      return `*${escapeTelegram(node.content ?? "")}*`;

    case "italic":
      return `_${escapeTelegram(node.content ?? "")}_`;

    case "code_inline":
      return `\`${node.content ?? ""}\``;

    case "link":
      return `[${escapeTelegram(node.content ?? "")}](${node.url ?? ""})`;

    case "list_item":
      return renderChildren(node.children);

    default:
      return node.content ?? "";
  }
}

function renderChildren(children?: IrNode[]): string {
  if (!children) return "";
  return children.map(renderNode).join("");
}
