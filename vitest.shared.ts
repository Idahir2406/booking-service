import path from "node:path";

import swc from "unplugin-swc";
import type { UserConfig } from "vitest/config";

export const vitestSwcPlugin = swc.vite({
  swcrc: false,
  jsc: {
    parser: {
      syntax: "typescript",
      decorators: true,
      dynamicImport: true,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
    },
    target: "esnext",
  },
  module: {
    type: "es6",
  },
});

export const vitestResolveConfig: UserConfig = {
  resolve: {
    alias: {
      "@/src": path.resolve(__dirname, "./src"),
      "@/app": path.resolve(__dirname, "./src/app"),
      "@/contexts": path.resolve(__dirname, "./src/contexts"),
      "@/shared": path.resolve(__dirname, "./src/contexts/shared"),
      "@/tests": path.resolve(__dirname, "./tests"),
    },
  },
};
