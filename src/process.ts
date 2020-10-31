import * as child_process from "child_process";
import * as chalk from "chalk";


function getCommandTitle(command: string, args: string[], options?: child_process.SpawnOptions): string {
  let inClause = options && options.cwd ? `(in ${ options.cwd })` : "";
  return `→ ${ command } ${ args.join(" ") } ${ inClause }`;
}


export async function runCommand(command: string, args: string[], options?: child_process.SpawnOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    let commandTitle = getCommandTitle(command, args, options);

    console.log(chalk.green(commandTitle));

    let proc = child_process.spawn(command, args, {
      ...options,
      stdio: "inherit"
    } as const);

    proc.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${ code }`));
      }
    });

    proc.on("error", error => {
      reject(error);
    });
  });
}


export function getYarnExecutable(): string {
  return process.platform === "win32" ? "yarn.cmd" : "yarn";
}
