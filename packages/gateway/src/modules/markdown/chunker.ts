/**
 * Split IR into channel-safe chunks (e.g., Telegram 4096 char limit).
 */

import type { IrNode } from "./parser.js";

export interface ChunkerOptions {
  maxChars: number;
}

/**
 * Split an array of IR nodes into chunks that each fit within maxChars
 * when rendered as plain text.
 */
export function chunkIrNodes(
  nodes: IrNode[],
  opts: ChunkerOptions,
): IrNode[][] {
  const { maxChars } = opts;
  const chunks: IrNode[][] = [];
  let current: IrNode[] = [];
  let currentSize = 0;

  for (const node of nodes) {
    const nodeSize = estimateNodeSize(node);

    if (currentSize + nodeSize > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }

    // If a single node exceeds the limit, split it (for paragraphs/code blocks)
    if (nodeSize > maxChars) {
      if (node.kind === "code_block" && node.content) {
        const lines = node.content.split("\n");
        let blockLines: string[] = [];
        let blockSize = 0;

        for (const line of lines) {
          if (
            blockSize + line.length + 1 > maxChars - 10 &&
            blockLines.length > 0
          ) {
            chunks.push([
              {
                kind: "code_block",
                content: blockLines.join("\n"),
                language: node.language,
              },
            ]);
            blockLines = [];
            blockSize = 0;
          }
          blockLines.push(line);
          blockSize += line.length + 1;
        }
        if (blockLines.length > 0) {
          current.push({
            kind: "code_block",
            content: blockLines.join("\n"),
            language: node.language,
          });
          currentSize += blockSize;
        }
      } else {
        // For other large nodes, add them as-is (renderer will handle truncation)
        current.push(node);
        currentSize += nodeSize;
      }
    } else {
      current.push(node);
      currentSize += nodeSize;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function estimateNodeSize(node: IrNode): number {
  let size = 0;

  if (node.content) {
    size += node.content.length;
  }

  if (node.children) {
    for (const child of node.children) {
      size += estimateNodeSize(child);
    }
  }

  // Add overhead for formatting markers
  switch (node.kind) {
    case "heading":
      size += (node.level ?? 1) + 1;
      break;
    case "code_block":
      size += 8; // ``` markers
      break;
    case "list_item":
      size += 2;
      break;
    case "bold":
      size += 4;
      break;
    case "italic":
      size += 2;
      break;
    case "code_inline":
      size += 2;
      break;
    case "link":
      size += 4 + (node.url?.length ?? 0);
      break;
  }

  return size;
}
