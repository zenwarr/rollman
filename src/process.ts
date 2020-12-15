import * as child_process from "child_process";
import * as chalk from "chalk";


function getCommandTitle(command: string, args: string[], options?: child_process.SpawnOptions): string {
  let inClause = options && options.cwd ? `(in ${ options.cwd })` : "";
  return `→ ${ command } ${ args.join(" ") } ${ inClause }`;
}


export type CommandOptions = child_process.SpawnOptions & {
  silent?: boolean;
  ignoreExitCode?: boolean;
};


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
    if (proc.stdout) {
      proc.stdout.on("data", text => output += text);
    }

    proc.on("close", code => {
      if (code === 0 || options?.ignoreExitCode === true) {
        resolve(output);
      } else {
        if (output) {
          console.error(output);
        }

        const error: any = new Error(`Process exited with code ${ code } (${ commandTitle })`);
        error.exitCode = code;
        reject(error);
      }
    });

    proc.on("error", error => {
      reject(error);
    });
  });
}


export async function fork(scriptPath: string, args: string[], options?: child_process.ForkOptions): Promise<void> {
  const child = child_process.fork(scriptPath, args, options);
  return new Promise<void>((resolve, reject) => {
    child.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Proces exited with code ${ code }`));
      }
    });
    child.on("error", reject);
  });
}


export async function getCommandOutput(command: string, args: string[], options?: CommandOptions): Promise<string> {
  return runCommand(command, args, {
    stdio: "pipe",
    silent: true,
    ...options
  });
}


export function getYarnExecutable(): string {
  return process.platform === "win32" ? "yarn.cmd" : "yarn";
}


export function getNpmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
