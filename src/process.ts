import * as child_process from "child_process";
import * as chalk from "chalk";


function getCommandTitle(command: string, args: string[], options?: child_process.SpawnOptions): string {
  let inClause = options && options.cwd ? `(in ${ options.cwd })` : "";
  return `→ ${ command } ${ args.join(" ") } ${ inClause }`;
}


export type CommandOptions = child_process.SpawnOptions & {
  silent?: boolean;
}


export async function runCommand(command: string, args: string[], options?: CommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let commandTitle = getCommandTitle(command, args, options);

    if (options?.silent !== true) {
      console.log(chalk.green(commandTitle));
    }

    let proc = child_process.spawn(command, args, {
      stdio: "inherit",
      ...options
    } as const);

    let output = "";
    proc.on("data", text => output += text);

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


export async function getCommandOutput(command: string, args: string[], options?: CommandOptions): Promise<string> {
  return runCommand(command, args, {
    stdio: "pipe",
    ...options,
  });
}


export function getYarnExecutable(): string {
  return process.platform === "win32" ? "yarn.cmd" : "yarn";
}


export function getNpmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
