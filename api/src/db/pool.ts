import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in");
}

// One pool for the process. Fastify's lifecycle (start/stop) owns closing
// it — see src/server.ts's onClose hook, not this module.
export const pool = new Pool({ connectionString });
