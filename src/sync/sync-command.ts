import { NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getDirectLocalDeps, walkAllLocalModules, WalkerAction } from "../deps/dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { publishModuleForSync } from "./publish";
import { ModSpecifier, installDependencies } from "./update-deps";
import { LocalModule } from "../local-module";
import { NpmViewInfo } from "./npm-view";
import { getPackageReader } from "../package-reader";
import * as semver from "semver";
import * as path from "path";
import { getNpmInfoReader } from "../npm-info-reader";


export interface PublishInfo {
  publishedVersion: string;
  info: NpmViewInfo;
}


export enum DepRequirementType {
  Prod,
  Dev
}


export interface DepRequirement {
  type: DepRequirementType;
  range: string;
}


function getRequirementOf(depMap: any, dep: string, type: DepRequirementType): DepRequirement | undefined {
  if (depMap && typeof depMap === "object" && depMap[dep] && typeof depMap[dep] === "string") {
    return { type, range: depMap[dep] };
  } else {
    return undefined;
  }
}


function getRequirement(parent: LocalModule, dep: string): DepRequirement | undefined {
  let packageJSON = getPackageReader().readPackageMetadata(parent.path);
  if (!packageJSON) {
    return undefined;
  }

  return getRequirementOf(packageJSON.dependencies, dep, DepRequirementType.Prod)
      || getRequirementOf(packageJSON.devDependencies, dep, DepRequirementType.Dev);
}


function maxSatisfyingWithPrerelease(versions: string[], pattern: string): string | undefined {
  let matchingVersions = versions.filter(v => {
    let coerced = semver.coerce(v);
    if (!coerced) {
      return false;
    }

    return semver.satisfies(coerced.version, pattern);
  });

  let greatest: string | undefined;
  for (let matchedVersion of matchingVersions) {
    if (!greatest || semver.gt(matchedVersion, greatest)) {
      greatest = matchedVersion;
    }
  }

  return greatest;
}


async function shouldUpdateDep(publishInfo: Map<LocalModule, PublishInfo>, parent: LocalModule, dep: LocalModule): Promise<ModSpecifier | undefined> {
  let pInfo = publishInfo.get(dep);
  if (!pInfo) {
    if (!dep.useNpm) {
      throw new Error(`Module ${ parent.checkedName.name } depends on ${ dep.checkedName.name }, but the latter has "useNpm" flag set to false`);
    } else {
      throw new Error(`Internal error: broken walk order for parent ${ parent.checkedName.name } and child ${ dep.checkedName.name }`);
    }
  }

  let requirement = getRequirement(parent, dep.checkedName.name);
  if (!requirement) {
    return undefined;
  }

  let installedDepVersion = await getInstalledVersion(parent, dep.checkedName.name);
  if (!installedDepVersion) {
    return {
      mod: dep,
      version: pInfo.publishedVersion
    };
  }

  if (semver.gt(pInfo.publishedVersion, installedDepVersion)) {
    return {
      mod: dep,
      version: pInfo.publishedVersion
    };
  }

  return undefined;
}

async function getInstalledVersion(parent: LocalModule, dep: string): Promise<string | undefined> {
  let depPath = path.join(parent.path, "node_modules", dep);
  let packageJSON = getPackageReader().readPackageMetadata(depPath);
  if (!packageJSON) {
    return undefined;
  }

  if (typeof packageJSON.version !== "string" || !packageJSON.version) {
    return undefined;
  }

  return packageJSON.version;
}


async function syncModules(): Promise<void> {
  await walkAllLocalModules(async module => fetchLocalModule(module));

  let publishInfo = new Map<LocalModule, PublishInfo>();
  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return WalkerAction.Continue;
    }

    // if we depend on modules that were upgraded and published on previous iterations, we should update them here.
    // we check if new version we just published still matches version pattern specified in this module, and only update if new version matches semver pattern.
    let depsToUpdate: ModSpecifier[] = []; // in this array we keep info on which modules update and which version to install
    for (let localDep of getDirectLocalDeps(mod)) {
      let req = await shouldUpdateDep(publishInfo, mod, localDep);
      if (req) {
        depsToUpdate.push(req);
      }
    }

    await installDependencies(mod, depsToUpdate);

    let publishedVersion = await publishModuleForSync(mod);
    if (publishedVersion) {
      publishInfo.set(mod, {
        publishedVersion,
        info: await getNpmInfoReader().getNpmInfo(mod)
      });
    } else {
      publishInfo.set(mod, {
        publishedVersion: getPackageReader().readPackageMetadata(mod.path).version,
        info: await getNpmInfoReader().getNpmInfo(mod)
      });
    }

    return WalkerAction.Continue;
  });
}


export async function syncCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync") {
    return;
  }

  await NpmRegistry.init();

  return syncModules();
}
