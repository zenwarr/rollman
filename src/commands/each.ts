import { walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import { getArgs } from "../arguments";
import { getManifestManager } from "../manifest-manager";
import { LocalModule } from "../local-module";
import {
  changedSincePublish,
  changedSinceVersionCommit, dependsOnOneOf
} from "../git";
import { getProject, shouldForcePublish } from "../project";
import assert from "assert";
import PromisePool from "@supercharge/promise-pool";
import * as os from "os";
import chalk from "chalk";


export async function eachCommand() {
  const args = getArgs();
  const project = getProject();

  if (args.subCommand !== "each") {
    throw new Error("expected subcommand to equal 'each'");
  }

  const changedModules: LocalModule[] = [];

  let shouldForce = false;
  if (args.notPublishedOnly) {
    shouldForce = await shouldForcePublish(project);
    if (shouldForce) {
      console.log("Workspace root yarn.lock changed since latest release, all modules are considered to be unpublished");
    }
  }

  async function shouldBeSkipped(mod: LocalModule) {
    assert(args.subCommand === "each");

    if (dependsOnOneOf(mod, changedModules)) {
      changedModules.push(mod);
      return false;
    }

    if (args.notPublishedOnly && shouldForce) {
      changedModules.push(mod);
      return false;
    }

    if (args.changedOnly && !(await changedSinceVersionCommit(mod))) {
      return true;
    }

    if (args.notPublishedOnly && !(await changedSincePublish(mod))) {
      return true;
    }

    changedModules.push(mod);
    return false;
  }

  const scriptName = args.args[0];

  const moduleNames = getProject().modules.map(mod => mod.checkedName.name);

  let modulesProcessed = 0;
  if (scriptName === "--") {
    if (args.args.length < 2) {
      throw new Error("Not enough arguments: expected at least one after --");
    }

    await runWithModules(args.parallel, async mod => {
      if (await shouldBeSkipped(mod)) {
        return;
      }

      ++modulesProcessed;
      await runCommand(args.args[1], args.args.slice(2), {
        cwd: mod.path,
        transformOutput: args.parallel ? output => withLinePrefix(moduleNames, mod.checkedName.name, output) : undefined
      });
    });
  } else {
    await runWithModules(args.parallel, async mod => {
      if (!mod.useNpm) {
        return;
      }

      if (await shouldBeSkipped(mod)) {
        return;
      }

      ++modulesProcessed;
      const manifest = getManifestManager().readPackageManifest(mod.path);
      if (!(scriptName in manifest.scripts)) {
        console.log(`Script ${ scriptName } not present in module ${ mod.checkedName.name }, skipping`);
        return;
      }

      await runCommand(getYarnExecutable(), args.args, {
        cwd: mod.path,
        transformOutput: args.parallel ? output => withLinePrefix(moduleNames, mod.checkedName.name, output) : undefined
      });
    });
  }

  if (!modulesProcessed) {
    console.log("Complete, no modules processed");
  }
}


function withLinePrefix(names: string[], name: string, output: string): string {
  const maxLength = Math.max(...names.map(name => name.length));
  const prefix = name.padEnd(maxLength, " ");

  return output.split("\n").map(line => `${ chalk.blue(prefix) } | ${ line }`).join("\n");
}


async function runWithModules(parallel: boolean, walker: (mod: LocalModule) => Promise<void>) {
  if (parallel) {
    const modules: LocalModule[] = [];

    await walkModules(async mod => {
      modules.push(mod);
    });

    const result = await PromisePool.withConcurrency(os.cpus().length).for(modules).process(walker);
    for (const err of result.errors) {
      console.error(`Task executed with error: ${ err }`);
    }

    if (result.errors.length) {
      throw new Error("Some tasks completed with errors");
    }
  } else {
    await walkModules(async mod => walker(mod));
  }
}
