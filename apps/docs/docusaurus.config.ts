import { themes as prismThemes } from "prism-react-renderer";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoDocsDir = resolve(currentDir, "../../docs");
const sidebarsPath = resolve(currentDir, "./sidebars.ts");
const customCssPath = resolve(currentDir, "./src/css/custom.css");

const config: Config = {
  title: "Tyrum",
  tagline: "Documentation",
  url: "https://docs.tyrum.ai",
  baseUrl: "/",
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
  themes: ["@docusaurus/theme-mermaid"],

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
          exclude: ["**/architecture-gap-closure/**"],
        },
        blog: false,
        theme: {
          customCss: customCssPath,
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Tyrum",
      items: [
        { to: "/install", label: "Install", position: "left" },
        { to: "/getting-started", label: "Quick Start", position: "left" },
        { to: "/architecture", label: "Architecture", position: "left" },
        {
          href: "https://github.com/rhernaus/tyrum",
          label: "GitHub",
          position: "right",
        },
      ],
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
