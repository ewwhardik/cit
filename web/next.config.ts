import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ["pg"],
  // The bundled demo dataset lives in ../starter (organiser files, never copied or edited).
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  outputFileTracingIncludes: { "/*": ["../starter/data/cit_public.json", "../starter/examples/*.json"] },
};

export default config;
