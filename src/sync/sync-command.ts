import { NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getDirectLocalDeps, walkAllLocalModules, WalkerAction } from "../deps/dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { publishModuleForSync } from "./publish";
import { ModSpecifier, installDependencies } from "./update-deps";
import { LocalModule } from "../local-module";
import { NpmViewInfo } from "./npm-view";
import { getPackageReader } from "../package-reader";
import { getProject } from "../project";


export interface PublishInfo {
  publishedVersion: string;
  info: NpmViewInfo;
}


async function syncModules(): Promise<void> {
  await walkAllLocalModules(async module => fetchLocalModule(module));

  let dirty: LocalModule[] = [];
  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return WalkerAction.Continue;
    }

    // if we depend on modules that were upgraded and published on previous iterations, we should update them here.
    // we check if new version we just published still matches version pattern specified in this module, and only update if new version matches semver pattern.
    let depsToUpdate: ModSpecifier[] = []; // in this array we keep info on which modules update and which version to install
    for (let localDep of getDirectLocalDeps(mod)) {
      if (dirty.includes(localDep)) {
        depsToUpdate.push({
          mod: localDep,
          version: getPackageReader().readPackageMetadata(localDep.path).version
        });
      }
    }

    await installDependencies(mod, depsToUpdate);

    let isUpdated = await publishModuleForSync(mod);
    if (isUpdated || depsToUpdate.length > 0) {
      dirty.push(mod);
    }

    return WalkerAction.Continue;
  });
}


async function syncSingleModule(mod: LocalModule): Promise<void> {
  await installDependencies(mod, getDirectLocalDeps(mod).map(dep => ({
    mod: dep,
    version: getPackageReader().readPackageMetadata(dep.path).version
  })));
}


export async function syncCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync") {
    return;
  }

  await NpmRegistry.init();

  if (args.depsOnly) {
    let mod = getProject().getModuleByPath(process.cwd());
    if (!mod) {
      throw new Error(`No local module found at the current directory: ${ process.cwd() }`);
    }

    return syncSingleModule(mod);
  } else {
    return syncModules();
  }
}
