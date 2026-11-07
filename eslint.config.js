import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const clockMessage = "The engine must not read the clock: time comes from the turn number.";
const mathMessage =
  "Results of this function differ between browsers. Use integer arithmetic or a lookup table.";

/** Math functions whose results are not specified to the last bit, so clients could disagree. */
const IMPRECISE_MATH = [
  ...["sin", "cos", "tan", "asin", "acos", "atan", "atan2"],
  ...["sinh", "cosh", "tanh", "asinh", "acosh", "atanh"],
  ...["exp", "expm1", "log", "log1p", "log2", "log10", "pow", "cbrt", "hypot"],
];

/**
 * The simulation must produce identical results on every client, so the engine,
 * and the contracts it is built on, may not use randomness, the clock or
 * platform-dependent maths.
 *
 * @type {import("eslint").Linter.Config}
 */
export const determinism = {
  files: ["packages/engine/**/*.ts", "packages/contracts/**/*.ts"],
  rules: {
    "no-restricted-properties": [
      "error",
      { object: "Math", property: "random", message: "Use the seeded Random instead." },
      ...IMPRECISE_MATH.map((property) => ({ object: "Math", property, message: mathMessage })),
    ],
    "no-restricted-syntax": [
      "error",
      {
        // Constants such as 2 ** 32 are exact; anything else is computed at run time.
        selector:
          "BinaryExpression[operator='**']:not([left.type='Literal'][right.type='Literal']), AssignmentExpression[operator='**=']",
        message: "Exponentiation can differ between browsers. Multiply integers instead.",
      },
    ],
    "no-restricted-globals": [
      "error",
      { name: "Date", message: clockMessage },
      { name: "performance", message: clockMessage },
      { name: "crypto", message: "Use the seeded Random instead." },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/*.config.*",
      "**/build.mjs",
      "tools/simulation-build.mjs",
      "apps/client/public/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      // A new order, structure or state must be handled wherever its kind is switched on.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false },
      ],
    },
  },
  determinism,
  prettier,
);
