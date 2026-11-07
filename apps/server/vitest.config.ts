import { configDefaults, defineProject } from "vitest/config";

export default defineProject({
  // test-bun/ runs under `bun test`: the Bun adapter needs Bun itself.
  test: { name: "server", exclude: [...configDefaults.exclude, "test-bun/**"] },
});
