import { expect } from "vitest";
import type { Page } from "playwright";

export async function assertSingleRowTabs(page: Page, selector: string): Promise<void> {
  const result = await page.evaluate((targetSelector) => {
    const list = document.querySelector<HTMLElement>(targetSelector);
    if (!list) {
      return { found: false, uniqueTopCount: 0, scrollable: false };
    }
    const triggerTops = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) =>
      Math.round(tab.getBoundingClientRect().top),
    );
    return {
      found: true,
      uniqueTopCount: new Set(triggerTops).size,
      scrollable: list.scrollWidth > list.clientWidth,
    };
  }, selector);

  expect(result.found, `${selector} should exist`).toBe(true);
  expect(result.uniqueTopCount).toBe(1);
  expect(typeof result.scrollable).toBe("boolean");
}

export async function assertChatMarkdownTypography(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const transcript = document.querySelector<HTMLElement>(
      '[data-testid="ai-sdk-chat-transcript"]',
    );
    return Boolean(
      transcript?.querySelector("h1") &&
      transcript.querySelector("p") &&
      transcript.querySelector("ul") &&
      transcript.querySelector("a") &&
      transcript.querySelector("pre"),
    );
  });

  const result = await page.evaluate(() => {
    const transcript = document.querySelector<HTMLElement>(
      '[data-testid="ai-sdk-chat-transcript"]',
    );
    const heading = transcript?.querySelector<HTMLElement>("h1");
    const paragraph = transcript?.querySelector<HTMLElement>("p");
    const list = transcript?.querySelector<HTMLElement>("ul");
    const link = transcript?.querySelector<HTMLElement>("a");
    const codeBlock = transcript?.querySelector<HTMLElement>("pre");
    if (!transcript || !heading || !paragraph || !list || !link || !codeBlock) {
      return {
        found: false,
        headingFontSize: 0,
        paragraphFontSize: 0,
        listStyleType: "",
        listPaddingLeft: 0,
        linkTextDecorationLine: "",
        codeWithinTranscript: false,
      };
    }

    const headingStyle = getComputedStyle(heading);
    const paragraphStyle = getComputedStyle(paragraph);
    const listStyle = getComputedStyle(list);
    const linkStyle = getComputedStyle(link);
    const transcriptRect = transcript.getBoundingClientRect();
    const codeRect = codeBlock.getBoundingClientRect();

    return {
      found: true,
      headingFontSize: Number.parseFloat(headingStyle.fontSize),
      paragraphFontSize: Number.parseFloat(paragraphStyle.fontSize),
      listStyleType: listStyle.listStyleType,
      listPaddingLeft: Number.parseFloat(listStyle.paddingLeft),
      linkTextDecorationLine: linkStyle.textDecorationLine,
      codeWithinTranscript: codeRect.right <= transcriptRect.right + 1,
    };
  });

  expect(result.found).toBe(true);
  expect(result.headingFontSize).toBeGreaterThan(result.paragraphFontSize);
  expect(result.listStyleType).toBe("disc");
  expect(result.listPaddingLeft).toBeGreaterThan(0);
  expect(result.linkTextDecorationLine).toContain("underline");
  expect(result.codeWithinTranscript).toBe(true);
}
