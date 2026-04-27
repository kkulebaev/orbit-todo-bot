import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // .env is optional — env vars may come from the runtime environment
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
