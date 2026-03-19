import { themes as prismThemes } from "prism-react-renderer";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoDocsDir = resolve(currentDir, "../../docs");
const sidebarsPath = resolve(currentDir, "./sidebars.ts");
const customCssPath = resolve(currentDir, "./src/css/custom.css");

const navbarItems = [
  { to: "/install", label: "Install", position: "left" },
  { to: "/getting-started", label: "Quick Start", position: "left" },
  { to: "/architecture", label: "Architecture", position: "left" },
  {
    href: "https://github.com/tyrumai/tyrum",
    label: "GitHub",
    position: "right",
  },
] satisfies NonNullable<Preset.ThemeConfig["navbar"]>["items"];

const config: Config = {
  title: "Tyrum",
  tagline: "Documentation",
  url: "https://docs.tyrum.ai",
  baseUrl: "/",
  favicon: "/img/brand/favicon.ico",
  trailingSlash: false,
  onBrokenLinks: "throw",

  organizationName: "tyrum",
  projectName: "tyrum",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  themes: [
    "@docusaurus/theme-mermaid",
    [
      "@easyops-cn/docusaurus-search-local",
      {
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: "/",
        docsDir: "../../docs",
        language: "en",
        hashed: true,
        searchBarPosition: "right",
        searchBarShortcut: true,
        searchBarShortcutHint: true,
        ignoreFiles: [/^\/_README$/],
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          path: repoDocsDir,
          routeBasePath: "/",
          sidebarPath: sidebarsPath,
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
        blog: false,
        theme: {
          customCss: customCssPath,
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/brand/social-card.png",
    navbar: {
      title: "Tyrum",
      logo: {
        alt: "Tyrum",
        src: "/img/brand/app-icon.svg",
      },
      items: navbarItems,
    },
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
    mermaid: {
      theme: { light: "neutral", dark: "dark" },
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
