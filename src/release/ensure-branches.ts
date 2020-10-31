import { LocalModule } from "../local-module";
import * as git from "nodegit";
import { getManifestReader } from "../manifest-reader";
import { walkModules } from "../dependencies";
import { ReleaseContext } from "./release-context";


const DEFAULT_RELEASE_BRANCH = "master";


async function ensureReleaseBranch(mod: LocalModule, repo: git.Repository): Promise<boolean> {
  const manifest = getManifestReader().readPackageManifest(mod.path);
  const releaseBranchesParam = manifest?.rollman?.releaseBranches;
  if (releaseBranchesParam && (!Array.isArray(releaseBranchesParam) || !releaseBranchesParam.every(x => typeof x === "string"))) {
    throw new Error(`Invalid rollman.releaseBranch parameter in module ${ mod.checkedName.name }: array of strings expected`);
  }

  const currentBranch = (await repo.getCurrentBranch()).name().replace(/^refs\/heads\//, "");

  const releaseBranches: string[] = releaseBranchesParam ?? [ DEFAULT_RELEASE_BRANCH ];
  if (!releaseBranches.includes(currentBranch)) {
    console.error(`Module ${ mod.checkedName.name } is on branch ${ currentBranch }, but releases are not allowed on this branch`);
    return false;
  }

  return true;
}


/**
 * Checks that all project modules are on git branch on which releases are allowed.
 */
export async function ensureReleaseBranches(ctx: ReleaseContext): Promise<boolean> {
  let result = true;

  await walkModules(async mod => {
    if (!mod.useNpm) {
      return;
    }

    const repo = await ctx.getRepo(mod);
    if (!repo) {
      return;
    }

    if (!await ensureReleaseBranch(mod, repo)) {
      result = false;
    }
  });

  return result;
}
