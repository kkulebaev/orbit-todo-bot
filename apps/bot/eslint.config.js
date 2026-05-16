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
      "no-restricted-imports": ["warn", {
        paths: [
          {
            name: "@prisma/client",
            message: "apps/bot must not import @prisma/client directly — will be enforced as error on P5.",
          },
        ],
        patterns: [
          {
            group: ["prisma/*", "*/prisma"],
            message: "apps/bot must not import Prisma — will be enforced as error on P5.",
          },
        ],
      }],
    },
  },
];
