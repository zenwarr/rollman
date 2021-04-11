import { getManifestManager } from "../manifest-manager";
import { getYarnExecutable, runCommand } from "../process";
import { getProject } from "../project";
import chalk from "chalk";
import { hasUncommittedChanges, isGitRepo, stageAllAndCommit } from "../git";
import { LocalModule } from "../local-module";
import { ReleaseContext } from "./release-context";


async function runLifecycleScript(scriptName: string, dir: string): Promise<boolean> {
  const manifest = getManifestManager().readPackageManifest(dir);
  if (!manifest.scripts || !(scriptName in manifest.scripts)) {
    return true;
  }

  try {
    await runCommand(getYarnExecutable(), [ "run", "--silent", scriptName ], {
      cwd: dir
    });
    return true;
  } catch (error) {
    return false;
  }
}


export async function runRootPrerelease() {
  if (!await runLifecycleScript("prerelease", getProject().rootDir)) {
    console.error("Prerelease script failed in workspace root, aborting");
    return false;
  } else {
    return true;
  }
}


export async function runModulePrerelease(ctx: ReleaseContext, mod: LocalModule) {
  if (!await runLifecycleScript("prerelease", mod.path)) {
    console.error(`Prerelease script failed for module ${ chalk.yellow(mod.checkedName.name) }, aborting`);
    return false;
  }

  if (!await isGitRepo(mod.path)) {
    return true;
  }

  if (await hasUncommittedChanges(mod.path)) {
    await stageAllAndCommit(mod, "chore: prerelease");
  }

  return true;
}
