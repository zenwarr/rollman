import chalk from "chalk";
import { listModulesCommand } from "./commands/list-modules";
import { dependencyTreeCommand } from "./commands/dependency-tree";
import { getArgs } from "./arguments";
import { Project } from "./project";
import { eachCommand } from "./commands/each";
import { publishCommand } from "./commands/publish";


async function asyncStart(): Promise<void> {
  console.log(`rollman v${ require("../package.json").version }`);

  let args = getArgs();

  Project.init();

  const COMMANDS: { [name: string]: () => Promise<void> | void } = {
    list: listModulesCommand,
    tree: dependencyTreeCommand,
    each: eachCommand,
    publish: publishCommand
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
    process.exit(0);
  });
}


process.on("SIGINT", () => {
  process.exit(1);
});


process.on("unhandledRejection", (error: unknown) => {
  console.error(chalk.red("Unhandled rejection"), error);
  process.exit(-1);
});


process.on("uncaughtException", (error: Error) => {
  console.error(chalk.red("Uncaught exception"), error);
  process.exit(-1);
});
