import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: "module", ecmaVersion: 2024 },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@prisma/client",
            message: "apps/bot must not import @prisma/client directly (P5 enforcement).",
          },
        ],
        patterns: [
          {
            group: ["prisma/*", "*/prisma"],
            message: "apps/bot must not import Prisma (P5 enforcement).",
          },
        ],
      }],
    },
  },
];
