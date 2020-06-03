import * as child_process from "child_process";
import * as chalk from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { getPackageReader } from "./package-reader";


type ExtraRunOptions = {
  silent?: boolean;
  collectOutput?: boolean;
  ignoreExitCode?: boolean;
};

export type SpawnOptions = child_process.SpawnOptions & ExtraRunOptions;
export type ExecOptions = child_process.ExecOptions & ExtraRunOptions;


export async function runCommand(command: string, args: null, options?: ExecOptions): Promise<string>;
export async function runCommand(command: string, args: string[], options?: SpawnOptions): Promise<string>;
export async function runCommand(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let silent = options && options.silent === true;

    if (!silent) {
      let inClause = options && options.cwd ? `(in ${options.cwd})` : "";
      if (args == null) {
        console.log(chalk.cyan(`→ ${command} ${inClause}`));
      } else {
        console.log(chalk.cyan(`→ ${command} ${args.join(" ")} ${inClause}`));
      }
    }

    let defOptions = options && options.collectOutput === true ? {} : {
      stdio: silent ? "ignore" : "inherit",
      stderr: silent ? "ignore" : "inherit"
    };

    let params = Object.assign(defOptions, options || {});

    let proc: child_process.ChildProcess;
    if (args == null) {
      proc = child_process.exec(command, params as ExecOptions);
    } else {
      proc = child_process.spawn(command, args, params as SpawnOptions);
    }

    let output = "";
    if (options && options.collectOutput && proc.stdout) {
      proc.stdout.on("data", data => {
        output += data;
      });
    }

    proc.on("close", code => {
      if (!silent) {
        console.log(chalk.cyan("→ DONE"));
      }
      if (code === 0) {
        resolve(output);
      } else if (options && options.ignoreExitCode) {
        resolve(output);
      } else {
        logProcessExecuteError(code, command, args, options);

        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", error => {
      if (!silent) {
        console.log(chalk.red(`→ ERROR: ${error.message}`));
      }
      reject(error);
    });
  });
}


function logProcessExecuteError(exitCode: number, command: string, args: null | string[], options?: SpawnOptions | ExecOptions) {
  console.log(chalk.red("Failed to execute the following command:"));
  if (args == null) {
    console.log(chalk.redBright("  " + command));
  } else {
    const commandParams = args.join(" ");
    console.log(chalk.redBright(`  ${command} ${commandParams}`));
  }

  if (options && options.cwd) {
    console.log(chalk.redBright("  in directory:", options.cwd));
  }

  if (exitCode === 127) {
    if (args == null) {
      console.log(chalk.red(`Please make sure executable exists, or, in case or running npm script, make sure that script ${command} exists`));
    } else {
      console.log(chalk.red("Please make sure executable exists"));
    }
  }
}


export function getDirectDeps(packagePath: string, includeDev: boolean = true): string[] {
  let pkg = getPackageReader().readPackageMetadata(packagePath);
  let deps = Object.keys(pkg.dependencies || {});
  if (includeDev) {
    deps = deps.concat(Object.keys(pkg.devDependencies || {}));
  }

  return deps;
}


export function getNpmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
