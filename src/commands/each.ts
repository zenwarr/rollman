import { walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import { getArgs } from "../arguments";
import { getManifestManager } from "../manifest-manager";
import assert = require("assert");
import { LocalModule } from "../local-module";
import {
  changedSincePublish,
  changedSinceVersionCommit, dependsOnOneOf
} from "../git";
import { getProject, shouldForcePublish } from "../project";


export async function eachCommand() {
  const args = getArgs();
  const project = getProject();

  assert(args.subCommand === "each");

  const changedModules: LocalModule[] = [];

  const shouldForce = await shouldForcePublish(project);
  if (shouldForce) {
    console.log("Workspace root yarn.lock changed since latest release, all modules are considered to be unpublished");
  }

  async function shouldBeSkipped(mod: LocalModule) {
    assert(args.subCommand === "each");

    if (args.changedOnly && !dependsOnOneOf(mod, changedModules) && !(await changedSinceVersionCommit(mod))) {
      return true;
    }

    if (args.notPublishedOnly && shouldForce) {
      return true;
    }

    if (args.notPublishedOnly && !dependsOnOneOf(mod, changedModules) && !(await changedSincePublish(mod))) {
      return true;
    }

    changedModules.push(mod);

    return false;
  }

  const scriptName = args.args[0];

  let modulesProcessed = 0;
  if (scriptName === "--") {
    if (args.args.length < 2) {
      throw new Error("Not enough arguments: expected at least one after --");
    }

    await walkModules(async mod => {
      if (await shouldBeSkipped(mod)) {
        return;
      }

      ++modulesProcessed;
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

      ++modulesProcessed;
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

  if (!modulesProcessed) {
    console.log("Complete, no modules processed");
  }
}
