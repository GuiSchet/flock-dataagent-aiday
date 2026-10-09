import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los CSV se leen del filesystem en el servidor; hay que incluirlos en el bundle de salida.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
