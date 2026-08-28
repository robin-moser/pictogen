import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

function requestMatchesHost(
  origin: string | undefined,
  host: string | undefined,
) {
  if (!origin || !host) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const backendTarget = `http://localhost:${environment.PORT || "3000"}`;
  const backendOrigin = new URL(environment.PUBLIC_URL || backendTarget).origin;

  return {
    plugins: [preact(), tailwindcss()],
    build: {
      outDir: "dist/client",
    },
    server: {
      allowedHosts: ["host.docker.internal"],
      proxy: {
        "/api": {
          target: backendTarget,
          configure(proxy) {
            proxy.on("proxyReq", (proxyRequest, request) => {
              if (
                requestMatchesHost(request.headers.origin, request.headers.host)
              ) {
                proxyRequest.setHeader("origin", backendOrigin);
              }
            });
          },
        },
      },
    },
  };
});
