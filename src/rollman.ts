import * as chalk from "chalk";
import { listModulesCommand } from "./commands/list-modules";
import { dependencyTreeCommand } from "./commands/dependency-tree";
import { ArgumentsManager, getArgs } from "./arguments";
import { shutdown } from "./shutdown";
import { releaseCommand } from "./release/release-command";
import { ManifestReader } from "./manifest-reader";
import { Project } from "./project";


async function asyncStart(): Promise<void> {
  ArgumentsManager.init();
  ManifestReader.init();

  let args = getArgs();

  Project.init();

  const COMMANDS: { [name: string]: () => Promise<void> | void } = {
    "list-modules": listModulesCommand,
    "dependency-tree": dependencyTreeCommand,
    release: releaseCommand
  };

  const command = COMMANDS[args.subCommand];
  if (!command) {
    throw new Error("Unknown command");
  }

  await command();
}


export function start(): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  asyncStart().then(() => {
    shutdown(0);
  });
}


process.on("SIGINT", () => {
  console.log("sigint");
  shutdown();
});


process.on("unhandledRejection", (error: unknown) => {
  console.error(chalk.red("Unhandled rejection"), error);
  shutdown(-1);
});


process.on("uncaughtException", (error: Error) => {
  console.error(chalk.red("Uncaught exception"), error);
  shutdown(-1);
});
