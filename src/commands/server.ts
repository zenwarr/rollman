import * as chalk from "chalk";
import { NpmRegistry } from "../registry";
import { getConfig, RegistryServerType } from "../config/config";
import { shutdown } from "../shutdown";
import * as events from "events";


class Piggy extends events.EventEmitter {
}


export async function startServerCommand(): Promise<void> {
  let config = getConfig();

  if (config.registryServerType !== RegistryServerType.ManagedLocal) {
    console.error(chalk.red("Cannot start local npm registry server: not configured to use local managed registry"));
    shutdown(-1);
  }

  await NpmRegistry.init();

  return new Promise(resolve => {
    let piggy = new Piggy();
    piggy.on("fly", () => {
      // we should never return, NpmRegistry class process.exit when server closes
      resolve();
    });
  });
}
