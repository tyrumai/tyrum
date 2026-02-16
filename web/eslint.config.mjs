import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
