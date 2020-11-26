import { getDirectModuleDeps, WalkerAction, walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import { getArgs } from "../arguments";
import { getManifestManager } from "../manifest-manager";
import assert = require("assert");
import { LocalModule } from "../local-module";
import { getCommitsSinceLastPublish, getCommitsSinceLatestVersion, hasUncommittedChanges, openRepo } from "../git";
import * as chalk from "chalk";


async function changedSinceVersionCommit(mod: LocalModule, changed: Set<LocalModule>): Promise<boolean> {
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

  console.log(`Module ${ chalk.yellow(mod.formattedName) } has no changes since previous version commit, skipping`);
  return false;
}


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

  const newCommitsInfo = await getCommitsSinceLastPublish(mod, repo);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  console.log(`Module ${ chalk.yellow(mod.formattedName) } has no changes since previous published version, skipping`);
  return false;
}


export async function eachCommand() {
  const args = getArgs();

  assert(args.subCommand === "each");

  const changedModules = new Set<LocalModule>();

  async function shouldBeSkipped(mod: LocalModule) {
    assert(args.subCommand === "each");

    if (args.changedOnly && !(await changedSinceVersionCommit(mod, changedModules))) {
      return true;
    }

    if (args.unpublishedOnly && !(await changedSincePublish(mod, changedModules))) {
      return true;
    }

    changedModules.add(mod);

    return false;
  }

  const scriptName = args.args[0];
  if (scriptName === "--") {
    if (args.args.length < 2) {
      throw new Error("Not enough arguments: expected at least one after --");
    }

    await walkModules(async mod => {
      if (await shouldBeSkipped(mod)) {
        return;
      }

      await runCommand(args.args[1], args.args.slice(2), {
        cwd: mod.path
      });
    });
  } else {
    await walkModules(async mod => {
      if (!mod.useNpm) {
        return;
      }

      if (await shouldBeSkipped(mod)) {
        return;
      }

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
