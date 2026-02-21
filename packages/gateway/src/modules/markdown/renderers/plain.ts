/**
 * IR -> plain text renderer (fallback).
 */

import type { IrNode } from "../parser.js";

export function renderPlain(nodes: IrNode[]): string {
  return nodes.map(renderNode).join("\n\n");
}

function renderNode(node: IrNode): string {
  switch (node.kind) {
    case "heading":
      return renderChildren(node.children);

    case "paragraph":
      return renderChildren(node.children);

    case "code_block":
      return node.content ?? "";

    case "list":
      return (node.children ?? [])
        .map((item, i) => {
          const prefix = node.ordered ? `${String(i + 1)}.` : "-";
          return `${prefix} ${renderChildren(item.children)}`;
        })
        .join("\n");

    case "horizontal_rule":
      return "---";

    case "text":
    case "bold":
    case "italic":
    case "code_inline":
      return node.content ?? "";

    case "link":
      return `${node.content ?? ""} (${node.url ?? ""})`;

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
