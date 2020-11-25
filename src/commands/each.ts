import { getDirectModuleDeps, walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import { getArgs } from "../arguments";
import { getManifestManager } from "../manifest-manager";
import assert = require("assert");
import { LocalModule } from "../local-module";
import { getCommitsSinceLatestVersion, hasUncommittedChanges, openRepo } from "../release/git";
import * as chalk from "chalk";


async function changedSincePublish(mod: LocalModule, changed: Set<LocalModule>): Promise<boolean> {
  const directModuleDeps = getDirectModuleDeps(mod, true);
  if (directModuleDeps.some(dep => changed.has(dep.mod))) {
    return true;
  }

  const repo = await openRepo(mod.path);
  if (!repo) {
    return false;
  }

  if (await hasUncommittedChanges(repo)) {
    return true;
  }

  const newCommitsInfo = await getCommitsSinceLatestVersion(repo);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  console.log(`Module ${chalk.yellow(mod.checkedName.name)} has no changes since previous version commit, skipping`);
  return false;
}


export async function eachCommand() {
  const args = getArgs();

  assert(args.subCommand === "each");

  const changedModules = new Set<LocalModule>();
  const scriptName = args.args[0];
  if (scriptName === "--") {
    if (args.args.length < 2) {
      throw new Error("Not enough arguments: expected at least one after --");
    }

    await walkModules(async mod => {
      if (args.changedOnly && !(await changedSincePublish(mod, changedModules))) {
        return;
      }

      changedModules.add(mod);

      await runCommand(args.args[1], args.args.slice(2), {
        cwd: mod.path
      });
    });
  } else {
    await walkModules(async mod => {
      if (!mod.useNpm) {
        return;
      }

      if (args.changedOnly && !(await changedSincePublish(mod, changedModules))) {
        return;
      }

      changedModules.add(mod);

      const manifest = getManifestManager().readPackageManifest(mod.path);
      if (!(scriptName in manifest.scripts)) {
        console.log(`Script ${ scriptName } not present in module ${ mod.checkedName.name }, skipping`);
        return;
      }

      await runCommand(getYarnExecutable(), args.args, {
        cwd: mod.path
      });
    });
  }
}
