import { LocalModule } from "../local-module";
import * as git from "nodegit";
import { walkModules } from "../dependencies";
import { ReleaseContext } from "./release-context";
import { getProject } from "../project";
import { getCurrentBranchName } from "./git";
import { isEmptyOrArrayOfStrings } from "../utils";


export const DEFAULT_RELEASE_BRANCH = "master";


export function isValidReleaseBranchesParam(input: unknown): input is string[] | undefined {
  return isEmptyOrArrayOfStrings(input);
}


async function ensureReleaseBranch(mod: LocalModule, repo: git.Repository): Promise<boolean> {
  const allowedBranches = mod.config.releaseBranches || getProject().options.releaseBranches;
  const currentBranch = await getCurrentBranchName(repo);

  if (!allowedBranches.includes(currentBranch)) {
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
