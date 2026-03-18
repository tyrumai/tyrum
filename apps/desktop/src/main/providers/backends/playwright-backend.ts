export interface PageSnapshot {
  html: string;
  title: string;
  url: string;
}

export interface PlaywrightBackend {
  ensureBrowser(): Promise<void>;
  navigate(url: string): Promise<{ title: string; url: string }>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  snapshot(): Promise<PageSnapshot>;
  close(): Promise<void>;

  goBack(): Promise<{ url: string; title?: string }>;
  hover(selector: string): Promise<void>;
  drag(sourceSelector: string, targetSelector: string): Promise<void>;
  type(selector: string, text: string, submit?: boolean): Promise<void>;
  selectOption(selector: string, values: string[]): Promise<string[]>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  screenshot(
    selector?: string,
    fullPage?: boolean,
  ): Promise<{ bytesBase64: string; mime: string; width?: number; height?: number }>;
  evaluate(expression: string): Promise<unknown>;
  waitFor(options: {
    selector?: string;
    url?: string;
    text?: string;
    timeoutMs?: number;
  }): Promise<boolean>;
  listTabs(): Promise<{
    tabs: Array<{ index: number; url: string; title?: string }>;
    activeIndex: number;
  }>;
  switchTab(index: number): Promise<void>;
  uploadFile(selector: string, paths: string[]): Promise<number>;
  getConsoleMessages(): Promise<Array<{ type: string; text: string }>>;
  getNetworkRequests(): Promise<
    Array<{ method: string; url: string; status?: number; contentType?: string }>
  >;
  resize(width: number, height: number): Promise<void>;
  handleDialog(
    accept: boolean,
    promptText?: string,
  ): Promise<{ dialogType?: string; message?: string }>;
  runCode(code: string): Promise<unknown>;
}
