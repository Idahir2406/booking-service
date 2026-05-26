import { defineConfig } from "vitest/config";

import { createVitestTestConfig } from "./create-vitest-test-config";
import { vitestResolveConfig, vitestSwcPlugin } from "./vitest.shared";

export default defineConfig({
  ...vitestResolveConfig,
  test: createVitestTestConfig("(unit|e2e)"),
  plugins: [vitestSwcPlugin],
});
