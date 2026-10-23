import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Screens load their data in an effect when a filter or id changes and show a spinner meanwhile (setLoading(true)
      // at the top of the effect). The rule flags that pattern; it is a recommendation, not a bug, so it warns instead of
      // failing CI. Move these to a data-fetching approach (Server Components, or a query library) when screens are reworked.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
