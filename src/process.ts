import * as child_process from "child_process";
import chalk from "chalk";


function getCommandTitle(command: string, args: string[], options?: child_process.SpawnOptions): string {
  let inClause = options && options.cwd ? `(in ${ options.cwd })` : "";
  return `→ ${ command } ${ args.join(" ") } ${ inClause }`;
}


export type CommandOptions = child_process.SpawnOptions & {
  silent?: boolean;
  ignoreExitCode?: boolean;
  transformOutput?: (output: string) => string;
};


export async function runCommand(command: string, args: string[], options?: CommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let commandTitle = getCommandTitle(command, args, options);

    if (options?.silent !== true) {
      console.log(chalk.green(commandTitle));
    }

    let proc = child_process.spawn(command, args, {
      stdio: options?.transformOutput ? [ "ignore", "pipe", "pipe" ] : "inherit",
      ...options
    } as const);

    let output = "";
    if (proc.stdout) {
      proc.stdout.on("data", text => {
        output += text;

        if (options?.transformOutput) {
          console.log(options.transformOutput(text.toString()));
        }
      });
    }

    if (proc.stderr && options?.transformOutput) {
      proc.stderr.on("data", text => {
        console.error(options.transformOutput!(text.toString()));
      });
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
