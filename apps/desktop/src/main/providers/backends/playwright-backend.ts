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
}
