import { walkModules, WalkerAction, getDirectDeps } from "../dependencies";
import { ensureDependenciesInstalled } from "../release/ensure-dependencies-installed";
import { ReleaseContext } from "../release/release-context";
import { getModulesToSkip, shouldBeSkipped } from "../release/skip-modules";
import { updateDependencies } from "../release/upgrade-ranges";
import { runModulePrerelease, runRootPrerelease } from "../release/lifecycle";
import { ensureReleaseBranches } from "../release/ensure-branches";
import { releaseModule } from "../release/release-module";


export async function releaseCommand() {
  if (!ensureDependenciesInstalled()) {
    return;
  }

  const ctx = new ReleaseContext();

  if (!await ensureReleaseBranches(ctx)) {
    return;
  }

  const modulesToSkip = await getModulesToSkip(ctx);
  if (!modulesToSkip) {
    return;
  }
  ctx.skipped = modulesToSkip;

  if (!await runRootPrerelease()) {
    return;
  }

  await walkModules(async mod => {
    const localDeps = getDirectDeps(mod);
    if (!mod.useNpm || shouldBeSkipped(ctx, localDeps, mod)) {
      ctx.skipped.push(mod);
      return WalkerAction.Continue;
    }

    if (!await ctx.getRepo(mod)) {
      return WalkerAction.Continue;
    }

    if (!await runModulePrerelease(ctx, mod)) {
      return WalkerAction.Stop;
    }

    await updateDependencies(ctx, mod, localDeps);

    await releaseModule(ctx, mod);

    return WalkerAction.Continue;
  });
}
