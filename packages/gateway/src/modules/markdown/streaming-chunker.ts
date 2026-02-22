/**
 * Streaming markdown chunker -- accumulates tokens into IR node
 * chunks respecting maxChars and code-fence boundaries.
 *
 * Designed for use with streaming LLM output where tokens arrive
 * incrementally and chunks must be emitted as soon as they are
 * large enough.
 */

import type { IrNode } from "./parser.js";
import { CODE_FENCE_START_RE, parseMarkdown } from "./parser.js";
import { estimateNodeSize } from "./chunker.js";

export interface StreamingChunkerOptions {
  maxChars: number;
  onChunk: (nodes: IrNode[]) => void;
}

export class StreamingChunker {
  private readonly maxChars: number;
  private readonly onChunk: (nodes: IrNode[]) => void;
  private buffer = "";
  private pendingNodes: IrNode[] = [];
  private pendingSize = 0;
  private inCodeFence = false;
  private codeFenceBuffer: string | null = null;
  private chunks = 0;

  constructor(opts: StreamingChunkerOptions) {
    this.maxChars = opts.maxChars;
    this.onChunk = opts.onChunk;
  }

  /** Feed an incremental token into the chunker. */
  push(token: string): void {
    this.buffer += token;

    // Process complete lines, but keep the last incomplete line buffered
    const lines = this.buffer.split("\n");
    // Last element is either "" (if buffer ended with \n) or an incomplete line
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.processLine(line);
    }
  }

  /** Flush remaining buffered content and emit a final chunk if needed. */
  flush(): void {
    if (this.buffer.length > 0) {
      this.processLine(this.buffer);
      this.buffer = "";
    }

    if (this.inCodeFence && this.codeFenceBuffer) {
      const fenceNodes = parseMarkdown(this.codeFenceBuffer);
      this.codeFenceBuffer = null;
      this.inCodeFence = false;
      for (const node of fenceNodes) {
        const nodeSize = estimateNodeSize(node);
        this.pendingNodes.push(node);
        this.pendingSize += nodeSize;
      }
    }

    if (this.pendingNodes.length > 0) {
      this.emitChunk();
    }
  }

  get chunkCount(): number {
    return this.chunks;
  }

  private processLine(line: string): void {
    // Keep fence detection aligned with the parser:
    // - Start fence: strict `^```(\\w*)$` (no leading whitespace, no trailing content)
    // - End fence: any line starting with ``` (no leading whitespace)
    const isFenceStartLine = CODE_FENCE_START_RE.test(line);
    const isFenceEndLine = line.startsWith("```");
    if (this.inCodeFence) {
      this.codeFenceBuffer = (this.codeFenceBuffer ?? "") + line + "\n";
      if (isFenceEndLine) {
        this.inCodeFence = false;
        const fenceNodes = parseMarkdown(this.codeFenceBuffer);
        this.codeFenceBuffer = null;
        for (const node of fenceNodes) {
          const nodeSize = estimateNodeSize(node);
          this.pendingNodes.push(node);
          this.pendingSize += nodeSize;
        }
      }
    } else if (isFenceStartLine) {
      this.inCodeFence = true;
      this.codeFenceBuffer = line + "\n";
    } else {
      // Parse this line as markdown to get IR nodes
      const lineNodes = parseMarkdown(line);
      for (const node of lineNodes) {
        const nodeSize = estimateNodeSize(node);
        this.pendingNodes.push(node);
        this.pendingSize += nodeSize;
      }
    }

    // Only emit a chunk at a safe boundary:
    // - Not inside a code fence
    // - Accumulated size exceeds maxChars
    if (!this.inCodeFence && this.pendingSize >= this.maxChars && this.pendingNodes.length > 0) {
      this.emitChunk();
    }
  }

  private emitChunk(): void {
    this.onChunk(this.pendingNodes);
    this.chunks += 1;
    this.pendingNodes = [];
    this.pendingSize = 0;
  }
}
