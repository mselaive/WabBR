import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const shared = fileURLToPath(new URL("../../packages/shared/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Se apunta al fuente TS del paquete compartido: nada que compilar aparte,
      // y el HMR funciona igual que si el código viviera en el cliente.
      "@wabbr/shared": `${shared}/index.ts`,
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
