import { LocalModule } from "../local-module";
import { ModuleDep, WalkerAction, walkModules } from "../dependencies";
import * as prompts from "prompts";
import * as chalk from "chalk";
import { cancelRelease, ReleaseContext } from "./release-context";
import { hasUncommittedChanges, isGitRepo } from "../git";


/**
 * For each module in the current project, checks if it has uncommitted changes and asks users for decision.
 * Returns list of modules user decided to skip, or `false` if he decided to completely interrupt release.
 * Modules without initialized git repository are automatically skipped.
 */
export async function getModulesToSkip(ctx: ReleaseContext): Promise<false | LocalModule[]> {
  let result: false | LocalModule[] = [];

  await walkModules(async mod => {
    if (!mod.useNpm) {
      return;
    }

    if (!await isGitRepo(mod.path)) {
      if (result !== false) {
        result.push(mod);
      }

      return;
    }

    if (await hasUncommittedChanges(mod.path)) {
      const reply = await prompts({
        type: "select",
        name: "value",
        message: `Module ${ chalk.yellow(mod.checkedName.name) } has uncommitted changes. Do you want to continue?`,
        choices: [
          {
            title: "No, abort release process and do nothing",
            value: "exit"
          },
          {
            title: "Continue, but do not release the module and all modules that depend on it",
            value: "ignore"
          }
        ]
      }, { onCancel: cancelRelease });

      if (reply.value === "exit") {
        result = false;
        return WalkerAction.Stop;
      } else if (reply.value === "ignore" && result) {
        result.push(mod);
      }
    }

    return undefined;
  });

  return result;
}


export function shouldBeSkipped(ctx: ReleaseContext, directLocalDeps: ModuleDep[], mod: LocalModule): boolean {
  if (ctx.skipped.includes(mod)) {
    return true;
  }

  const skipReason = directLocalDeps.find(d => ctx.skipped.includes(d.mod));
  if (skipReason) {
    console.log(`Skipping module ${ chalk.yellow(mod.checkedName.name) } because it depends on ignored module ${ chalk.yellow(skipReason.mod.checkedName.name) }`);
    return true;
  }

  return false;
}
