import { createServer } from "http";
import { config } from "./config.js";
import { ChainClient } from "./chain/ChainClient.js";
import { MiningController } from "./chain/MiningController.js";
import { PoolRegistry } from "./market/PoolRegistry.js";
import { MarketHistory } from "./market/MarketHistory.js";
import { BotScheduler } from "./bots/BotScheduler.js";
import { TriggerRegistry } from "./triggers/TriggerRegistry.js";
import { TriggerEngine } from "./triggers/TriggerEngine.js";
import { ChallengeLoader } from "./challenge/ChallengeLoader.js";
import { ChallengeRunner } from "./challenge/ChallengeRunner.js";
import { ContractRegistry } from "./challenge/ContractRegistry.js";
import { PlayerSession } from "./player/PlayerSession.js";
import { ScriptSandbox } from "./player/ScriptSandbox.js";
import { WSServer } from "./ws/WSServer.js";
import { createHttpServer } from "./api/httpServer.js";

async function main() {
  console.log("[defi-ctf] engine starting...");

  const client  = new ChainClient();
  const mining  = new MiningController(client);
  const pools   = new PoolRegistry(client);
  const history = new MarketHistory();
  const triggerReg = new TriggerRegistry();

  let wsServer: WSServer | null = null;
  const broadcast = (type: string, payload: unknown) => wsServer?.broadcast(type, payload);

  const triggers         = new TriggerEngine(triggerReg, pools, broadcast);
  const contractRegistry = new ContractRegistry(client);
  const bots             = new BotScheduler(client, pools, contractRegistry, history);

  const loader = new ChallengeLoader();
  loader.load();

  const runner  = new ChallengeRunner(client, mining, pools, history, bots, triggers, contractRegistry, broadcast);
  const sandbox = new ScriptSandbox(pools, history, broadcast, contractRegistry);

  try {
    const snapshotId = await client.rpc<string>("evm_snapshot", []);
    process.env.CHAIN_SNAPSHOT_ID = snapshotId;
    console.log(`[defi-ctf] chain snapshot saved: ${snapshotId}`);
  } catch (e) {
    console.warn("[defi-ctf] snapshot failed:", e);
  }

  const app        = createHttpServer(loader, runner, history, triggerReg, pools, client, contractRegistry);
  const httpServer = createServer(app);
  wsServer         = new WSServer(httpServer, runner, mining, loader, sandbox, triggerReg, client, pools, contractRegistry);

  httpServer.listen(config.httpPort, () => {
    console.log(`[defi-ctf] engine ready`);
    console.log(`  API: http://localhost:${config.httpPort}/api`);
    console.log(`  WS:  ws://localhost:${config.httpPort}/ws`);
  });

  const shutdown = async () => {
    console.log("\n[defi-ctf] shutting down...");
    await runner.stop();
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);
}

main().catch((e) => { console.error("[defi-ctf] fatal:", e); process.exit(1); });
