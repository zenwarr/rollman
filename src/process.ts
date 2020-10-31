import * as child_process from "child_process";
import * as chalk from "chalk";
import * as ora from "ora";


type ExtraRunOptions = {
  ignoreExitCode?: boolean;
};

export type SpawnOptions = child_process.SpawnOptions & ExtraRunOptions;
export type ExecOptions = child_process.ExecOptions & ExtraRunOptions;


function getCommandTitle(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): string {
  let inClause = options && options.cwd ? `(in ${ options.cwd })` : "";
  if (args == null) {
    return `→ ${ command } ${ inClause }`;
  } else {
    return `→ ${ command } ${ args.join(" ") } ${ inClause }`;
  }
}


function execOrSpawn(command: string, args: string[] | null, options?: ExecOptions | SpawnOptions) {
  if (args == null) {
    return child_process.exec(command, options as ExecOptions);
  } else {
    return child_process.spawn(command, args, options as SpawnOptions);
  }
}


export async function getCommandOutput(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let params = {
      ...options,
      stdio: "pipe",
      stderr: "pipe"
    } as const;

    let proc = execOrSpawn(command, args, params);

    let output = "";
    if (proc.stdout) {
      proc.stdout.on("data", data => {
        output += data;
      });
    }

    proc.on("close", code => {
      if (code === 0) {
        resolve(output);
      } else if (options && options.ignoreExitCode) {
        resolve(output);
      } else {
        logProcessExecuteError(code, command, args, options);
        reject(new Error(`Process exited with code ${ code }`));
      }
    });

    proc.on("error", error => {
      reject(error);
    });
  });
}


export async function runCommand(command: string, args: null, options?: ExecOptions): Promise<string>;
export async function runCommand(command: string, args: string[], options?: SpawnOptions): Promise<string>;
export async function runCommand(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let verbose = false;
    let commandTitle = getCommandTitle(command, args, options);

    let commandSpinner: ora.Ora | undefined;
    if (verbose) {
      console.log(chalk.green(commandTitle));
    } else {
      commandSpinner = ora({
        text: chalk.green(commandTitle),
        spinner: "bouncingBar",
        color: "green"
      }).start();
    }

    let params = {
      ...options,
      stdio: verbose ? "inherit" : "pipe",
      stderr: verbose ? "inherit" : "pipe"
    } as const;
    let proc = execOrSpawn(command, args, params);

    let output = "";
    let errorOutput = "";
    if (proc.stdout) {
      proc.stdout.on("data", data => {
        output += data;
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", data => {
        errorOutput += data;
      });
    }

    proc.on("close", code => {
      if (code === 0) {
        if (verbose) {
          console.log(chalk.green("→ DONE"));
        }
        commandSpinner?.succeed();

        resolve(output);
      } else if (options && options.ignoreExitCode) {
        if (verbose) {
          console.log(chalk.green(`→ DONE (exit code ${ code })`));
        }

        commandSpinner?.succeed();
        resolve(output);
      } else {
        commandSpinner?.fail();

        if (verbose) {
          console.log(chalk.red(`→ ERROR: exit code ${ code }`));
        } else {
          console.log(output);
          console.error(chalk.red(errorOutput));
        }

        logProcessExecuteError(code, command, args, options);

        reject(new Error(`Process exited with code ${ code }`));
      }
    });

    proc.on("error", error => {
      commandSpinner?.fail();
      console.log(chalk.red(`→ ERROR: ${ error.message }`));
      reject(error);
    });
  });
}


function logProcessExecuteError(exitCode: number, command: string, args: null | string[], options?: SpawnOptions | ExecOptions) {
  if (exitCode === 127) {
    if (args == null) {
      console.log(chalk.red(`Please make sure executable exists, or, in case or running npm script, make sure that script ${ command } exists`));
    } else {
      console.log(chalk.red("Please make sure executable exists"));
    }
  }
}


export function getNpmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}


export async function operationSpinner<T>(text: string, callback: () => Promise<T>): Promise<T> {
  let commandSpinner = ora({
    text: chalk.green(text),
    spinner: "bouncingBar",
    color: "green"
  }).start();

  try {
    let result = await callback();
    commandSpinner.succeed();
    return result;
  } catch (error) {
    commandSpinner.fail();
    throw error;
  }
}
