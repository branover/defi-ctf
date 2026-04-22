import { request } from "@playwright/test";

const ENGINE_URL  = process.env.ENGINE_URL  ?? "http://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

export default async function globalSetup() {
  const ctx = await request.newContext();

  let engineOk = false;
  try {
    const r = await ctx.get(`${ENGINE_URL}/health`, { timeout: 5000 });
    engineOk = r.ok();
  } catch {}

  if (!engineOk) {
    throw new Error(
      `Engine not reachable at ${ENGINE_URL}. Run ./start.sh before running Playwright tests.`
    );
  }

  let frontendOk = false;
  try {
    const r = await ctx.get(FRONTEND_URL, { timeout: 5000 });
    frontendOk = r.ok();
  } catch {}

  if (!frontendOk) {
    throw new Error(
      `Frontend not reachable at ${FRONTEND_URL}. Run ./start.sh before running Playwright tests.`
    );
  }

  await ctx.dispose();
}
