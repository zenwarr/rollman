import { getDirectModuleDeps, walkModules } from "../dependencies";
import { LocalModule } from "../local-module";
import { getVersionTags, tagHead } from "../git";
import { getNpmExecutable, runCommand } from "../process";
import { getProject, ROOT_REPO_RELEASE_TAG_PREFIX, shouldForcePublish } from "../project";
import { getManifestManager } from "../manifest-manager";
import { generateLockFile } from "lockfile-generator";
import { MetaInfo } from "lockfile-generator/declarations/lib/MetaInfoResolver";
import { getPublishedPackageInfo, isVersionPublished } from "../registry";
import * as semver from "semver";
import { getArgs } from "../arguments";
import * as path from "path";
import * as fs from "fs-extra";
import * as _ from "lodash";
import { timeout } from "../utils";
import { Commit } from "conventional-commits-parser";


const conventionalRecommendedBump = require("../recommended-bump");


function shouldPublishIfSourceNotChanged(mod: LocalModule): boolean {
  const project = getProject();
  return mod.config.publishIfSourceNotChanged ?? project.options.publishIfSourceNotChanged;
}


async function getCurrentVersionFromTags(dir: string, prerelease: string | undefined): Promise<string> {
  const versionTags = (await getVersionTags(dir))
    .filter(tag => {
      if (prerelease != null) {
        return true;
      } else {
        return semver.prerelease(tag.version) == null;
      }
    })
    .sort((a, b) => {
      if (semver.eq(a.version, b.version)) {
        return 0;
      } else {
        return semver.gt(a.version, b.version) ? -1 : 1;
      }
    });

  let currentVersion = versionTags[0];

  if (!currentVersion) {
    return getManifestManager().readPackageManifest(dir).version;
  } else {
    return currentVersion.version;
  }
}


async function getVersionAfterBump(dir: string, currentVersion: string, prerelease: string | undefined, localUpdates: string[]): Promise<[ version: string, reason: string[] ]> {
  const rec = await new Promise<any & { commitCount: number }>((resolve, reject) => {
    conventionalRecommendedBump({
      cwd: dir,
      skipUnstable: prerelease == null,
      whatBump: (commits: Commit[]) => {
        let level = 2;
        let breakings = 0;
        let features = 0;

        commits.forEach(commit => {
          if (commit.notes.length > 0) {
            breakings += commit.notes.length;
            level = 0;
          } else if (commit.type === "feat" || commit.type === "feature") {
            features += 1;
            if (level === 2) {
              level = 1;
            }
          }
        });

        return {
          level,
          reason: breakings === 1
            ? `There is ${ breakings } BREAKING CHANGE and ${ features } features`
            : `There are ${ breakings } BREAKING CHANGES and ${ features } features`,
          commitCount: commits.length
        };
      }
    } as any, (err: Error | null, result: any) => {
      if (err != null) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });

  if (!rec.commitCount || !rec.releaseType) {
    if (localUpdates.length) {
      return [
        bumpVersion(currentVersion, "patch", prerelease),
        localUpdates
      ];
    } else {
      // const curIds = (semver.prerelease(currentVersion) ?? []).filter(x => typeof x === "string");
      // const wantedIds = prerelease != null ? [ prerelease ] : [];
      // if (!_.isEqual(curIds, wantedIds)) {
      //   return [
      //     bumpVersion(currentVersion, "patch", prerelease),
      //     [ `prerelease ids differ: current are ${ curIds.join(", ") || "<none>" }, requested are ${ wantedIds.join(", ") || "<none>" }` ]
      //   ];
      // } else {
      return [
        currentVersion,
        [ "no reason found to change package version" ]
      ];
      // }
    }
  } else {
    return [
      bumpVersion(currentVersion, rec.releaseType, prerelease),
      [ `bumped by ${ rec.commitCount } semantic commits: ${ rec.reason }` ]
    ];
  }
}


function bumpVersion(version: string, bump: "minor" | "major" | "patch", prerelease: string | undefined) {
  let bumped: string | null;
  if (prerelease != null) {
    bumped = semver.inc(version, "pre" + bump as semver.ReleaseType, prerelease);
  } else {
    bumped = semver.inc(version, bump);
  }

  return bumped ?? version;
}


interface BumpInfo {
  oldVersion: string;
  newVersion: string;
  versionTag?: string;
}


async function setNewVersion(mod: LocalModule, currentVersion: string, prerelease: string | undefined, localUpdates: string[]): Promise<BumpInfo> {
  let [ newVersion, bumpReason ] = await getVersionAfterBump(mod.path, currentVersion, prerelease, localUpdates);

  const manifest = await getManifestManager().readPackageManifest(mod.path);
  manifest.version = newVersion;
  getManifestManager().writePackageManifest(mod.path, manifest);

  let versionTag: string | undefined;
  if (currentVersion !== newVersion) {
    const formattedBumpReason = bumpReason.map(reason => "  " + reason).join("\n");
    console.log(`${ mod.checkedName.name }: bumping version (${ currentVersion } -> ${ newVersion }):\n${ formattedBumpReason }`);

    versionTag = `v${ newVersion }`;
    await tagHead(mod.path, newVersion);
  } else {
    console.log(`${ mod.checkedName.name }: no reason to bump version from ${ currentVersion }`);
  }

  return {
    oldVersion: currentVersion,
    newVersion,
    versionTag
  };
}


export async function publishCommand(): Promise<void> {
  const project = getProject();
  const localModulesMeta = new Map<string, MetaInfo>();
  const dirtyModules: LocalModule[] = [];

  const args = getArgs();
  if (args.subCommand !== "publish") {
    throw new Error("Expected publish command");
  }

  const lockfileChanged = await shouldForcePublish(project);
  if (lockfileChanged) {
    console.log("Workspace root yarn.lock changed since latest release, forcing full update");
  }

  console.log("Calculating new versions...");

  const moduleVersions = new Map<LocalModule, BumpInfo>();
  await walkModules(async mod => {
    // if module dependencies changes, we need to publish new version with another version number
    // but we are not going to commit changes in `package.json`
    // so we have to choose new version without help of conventional-commits
    // and how to determine bump for new version when only dependencies changed?
    // for example, if one of dependencies got a major bump, should we major bump this package too?
    // it depends on internal application logic, so we cannot know

    const currentVersion = await getCurrentVersionFromTags(mod.path, args.prerelease);
    let localUpdates: string[] = await updateManifestDeps(mod, currentVersion, moduleVersions);

    if (project.options.useLockFiles && (mod.alwaysUpdateLockFile || shouldUpdateLockfileForModule(mod, args.lockfileCheckProperty))) {
      await generateLockFile(mod.path, localModulesMeta);

      if (args.lockfileCopyPath) {
        const parentDir = path.dirname(args.lockfileCopyPath);
        if (parentDir !== ".") {
          fs.mkdirSync(path.join(mod.path, parentDir), { recursive: true });
        }

        fs.moveSync(path.join(mod.path, "package-lock.json"), path.join(mod.path, args.lockfileCopyPath), {
          overwrite: true
        });
      }

      // todo: only if lockfile changed
      localUpdates.push("generated lockfile changed");
    }

    if (!localUpdates && shouldPublishIfSourceNotChanged(mod)) {
      localUpdates = getDirectModuleDeps(mod, true)
        .filter(dep => dirtyModules.includes(dep.mod))
        .map(dep => `should be published if dependencies change, and module ${ dep.mod.checkedName.name } has changed`);
    }

    const bumpInfo = await setNewVersion(mod, currentVersion, args.prerelease, localUpdates);
    moduleVersions.set(mod, bumpInfo);

    if (bumpInfo.oldVersion !== bumpInfo.newVersion) {
      dirtyModules.push(mod);
    }
  });

  // console.log("Pushing tags...");
  //
  // let pushedCount = 0;
  // for (const [ mod, bump ] of moduleVersions.entries()) {
  //   if (bump.versionTag) {
  //     await pushTag(mod.path, bump.versionTag, args.dryRun);
  //     ++pushedCount;
  //   }
  // }
  //
  // if (!pushedCount) {
  //   console.log("There are no tags to push");
  // }
  //
  // console.log("Publishing modules...");
  //
  // let publishedCount = 0;
  // for (const mod of dirtyModules) {
  //   const currentVersion = moduleVersions.get(mod)!.newVersion;
  //   if (await isVersionPublished(mod.checkedName.name, currentVersion)) {
  //     continue;
  //   }
  //
  //   const publishTag = await getPublishTag(mod.checkedName.name, moduleVersions.get(mod)!.newVersion);
  //   let publishArgs = [ "publish", mod.path, "--tag", publishTag ];
  //   if (args.dryRun) {
  //     publishArgs.push("--dry-run");
  //   }
  //
  //   await runCommand(getNpmExecutable(), publishArgs, {
  //     cwd: project.rootDir
  //   });
  //
  //   ++publishedCount;
  // }
  //
  // if (!publishedCount) {
  //   console.log("There are no modules to publish");
  // }
  //
  // if (lockfileChanged) {
  //   console.log("Publishing changed lockfile...");
  //
  //   const rootReleaseTag = ROOT_REPO_RELEASE_TAG_PREFIX + new Date().valueOf();
  //   await tagHead(project.rootDir, rootReleaseTag);
  //   await pushTag(project.rootDir, rootReleaseTag, args.dryRun);
  // }
}


function shouldUpdateLockfileForModule(mod: LocalModule, checkProperty: string | undefined): boolean {
  if (!checkProperty) {
    return false;
  }

  const manifest = getManifestManager().readPackageManifest(mod.path);
  return !!(_.get(manifest, checkProperty));
}


async function updateManifestDeps(mod: LocalModule, currentVersion: string, newVersions: Map<LocalModule, BumpInfo>): Promise<string[]> {
  const manifest = getManifestManager().readPackageManifest(mod.path);
  const publishedManifest = await getPublishedPackageInfo(`${ mod.checkedName.name }@${ currentVersion }`);
  let updates: string[] = [];

  function fixDep(manifest: any, depType: string, dep: string, newVersion: string) {
    const deps = manifest[depType] ?? {};
    const publishedDeps = publishedManifest?.manifest?.[depType] ?? {};

    const existingRange = deps[dep];
    if (!existingRange) {
      return;
    }

    let updatedRange = existingRange;
    if (existingRange === "*") {
      updatedRange = newVersion;
    } else if (!semver.satisfies(newVersion, existingRange)) {
      updatedRange = `^${ newVersion }`;
    }

    deps[dep] = updatedRange;

    const publishedRange = publishedDeps[dep];
    if (publishedManifest && publishedRange !== updatedRange) {
      updates.push(`dependency range changed: new version ${ newVersion } of module ${ dep } no longer matches range ${ publishedRange }, upgraded to ${ updatedRange }`);
    }
  }

  for (const [ dep, bump ] of newVersions.entries()) {
    fixDep(manifest, "dependencies", dep.checkedName.name, bump.newVersion);
    fixDep(manifest, "devDependencies", dep.checkedName.name, bump.newVersion);
  }

  getManifestManager().writePackageManifest(mod.path, manifest);

  return updates;
}


async function pushTag(dir: string, tag: string, dryRun: boolean) {
  const TRY_COUNT = 5;

  const args = [ "push", "origin", "--follow-tags" ];
  if (dryRun) {
    args.push("--dry-run");
  }

  for (let q = 0; q < TRY_COUNT; ++q) {
    try {
      await runCommand("git", args, {
        cwd: dir
      });
      return;
    } catch (error) {
      console.log(`Failed to push: ${ error.message }, repeating command in 1s...`);
      await timeout(1000);
    }
  }

  throw new Error(`Failed to execute command after ${ TRY_COUNT } attempts`);
}


async function getPublishTag(packageName: string, newVersion: string): Promise<string> {
  const LATEST_TAG = "latest";
  const RECENT_TAG = "recent";

  const publishedInfo = await getPublishedPackageInfo(packageName);

  // set latest tag if package has not been published yet
  if (!publishedInfo) {
    return LATEST_TAG;
  }

  // never set latest for prerelease
  const prereleases = semver.prerelease(newVersion);
  if (prereleases != null && prereleases.length > 0) {
    return prereleases[0];
  }

  // set latest only if new version if greater than every other published version
  if (publishedInfo.versions.every(v => semver.lt(v, newVersion))) {
    return LATEST_TAG;
  }

  return RECENT_TAG;
}
