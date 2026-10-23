import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/*.config.*", "**/build.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The simulation must produce identical results on every client.
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded Random instead." },
        { object: "Date", property: "now", message: "The engine must not read the clock." },
      ],
      "no-restricted-globals": [
        "error",
        { name: "performance", message: "The engine must not read the clock." },
      ],
    },
  },
  prettier,
);
