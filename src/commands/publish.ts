import { walkModules } from "../dependencies";
import { LocalModule } from "../local-module";
import { changedSincePublish, dependsOnOneOf, isGitRepo, tagHead } from "../git";
import { fork, getNpmExecutable, runCommand } from "../process";
import { getProject, ROOT_REPO_RELEASE_TAG_PREFIX, shouldForcePublish } from "../project";
import { getManifestManager } from "../manifest-manager";
import { generateLockFile } from "lockfile-generator";
import { MetaInfo } from "lockfile-generator/declarations/lib/MetaInfoResolver";
import { getPublishedPackageInfo } from "../registry";
import * as semver from "semver";
import { getArgs } from "../arguments";
import * as path from "path";
import * as fs from "fs-extra";
import * as _ from "lodash";


async function moduleShouldBePublished(mod: LocalModule, dirtyModules: LocalModule[]): Promise<boolean> {
  if (!mod.useNpm || !await isGitRepo(mod.path)) {
    return false;
  }

  if (await changedSincePublish(mod)) {
    dirtyModules.push(mod);
    return true;
  }

  if (dependsOnOneOf(mod, dirtyModules)) {
    dirtyModules.push(mod);
    return true;
  }

  return false;
}


/**
 * If we are switching from prerelease versions to release, we should always remove prerelease from version and set release version.
 * This function returns true if this is the case and we should force-change current version even if there are no changes.
 */
function shouldChangeVersion(mod: LocalModule, prerelease: string | undefined): boolean {
  const currentVersion = getCurrentPackageVersion(mod.path);
  if (semver.prerelease(currentVersion) && !prerelease) {
    return true;
  }

  return false;
}


export async function publishCommand(): Promise<void> {
  const project = getProject();
  const toPublish: LocalModule[] = [];
  const dirtyModules: LocalModule[] = [];
  const localModulesMeta = new Map<string, MetaInfo>();

  const args = getArgs();
  if (args.subCommand !== "publish") {
    throw new Error("Expected publish command");
  }

  const lockfileChanged = await shouldForcePublish(project);
  if (lockfileChanged) {
    console.log("Workspace root yarn.lock changed since latest release, forcing full update");
  }

  await walkModules(async mod => {
    if (lockfileChanged || await moduleShouldBePublished(mod, dirtyModules) || shouldChangeVersion(mod, args.prerelease)) {
      toPublish.push(mod);
    } else {
      console.log(`Module ${ mod.formattedName } has no changes since last published version, skipping`);
      localModulesMeta.set(
        mod.checkedName.name,
        await getPublishedPackageMetaInfo(mod.checkedName.name, getCurrentPackageVersion(mod.path))
      );
    }
  });

  const newVersions = new Map<LocalModule, string>();

  for (const mod of toPublish) {
    if (dependsOnOneOf(mod, [ ...newVersions.keys() ])) {
      updateManifestDeps(mod, newVersions);
    }

    let semanticVersionArgs = [ "--dir", mod.path ];
    if (args.prerelease) {
      semanticVersionArgs.push("--prerelease", args.prerelease);
    }

    await fork(require.resolve("../release/semantic-version"), semanticVersionArgs);
    newVersions.set(mod, getCurrentPackageVersion(mod.path));

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
    }
  }

  for (const mod of toPublish) {
    if (args.dryRun) {
      console.log(`(dry run): would push changes to module ${ mod.path }`);
    } else {
      await pushChanges(mod.path, args.dryRun);
    }
  }

  for (const mod of toPublish) {
    const manifest = getManifestManager().readPackageManifest(mod.path);
    const newVersion = manifest.version;

    const publishTag = await getPublishTag(mod.checkedName.name, newVersion);
    let publishArgs = [ "publish", mod.path, "--tag", publishTag ];
    if (args.dryRun) {
      publishArgs.push("--dry-run");
    }
    await runCommand(getNpmExecutable(), publishArgs, {
      cwd: project.rootDir
    });
  }

  if (lockfileChanged) {
    const rootReleaseTag = ROOT_REPO_RELEASE_TAG_PREFIX + new Date().valueOf();
    await tagHead(project.rootDir, rootReleaseTag);
    if (args.dryRun) {
      console.log("(dry run): would push changes to root repository");
    } else {
      await pushChanges(project.rootDir, args.dryRun);
    }
  }
}


function shouldUpdateLockfileForModule(mod: LocalModule, checkProperty: string | undefined): boolean {
  if (!checkProperty) {
    return false;
  }

  const manifest = getManifestManager().readPackageManifest(mod.path);
  return !!(_.get(manifest, checkProperty));
}


function updateManifestDeps(mod: LocalModule, newVersions: Map<LocalModule, string>) {
  const manifest = getManifestManager().readPackageManifest(mod.path);

  function fixDep(deps: any, dep: string, newVersion: string) {
    const existingRange = deps[dep];
    if (!semver.satisfies(newVersion, existingRange)) {
      deps[dep] = `^${ newVersion }`;
    }
  }

  for (const [ dep, newVersion ] of newVersions.entries()) {
    fixDep(manifest.dependencies || {}, dep.checkedName.name, newVersion);
    fixDep(manifest.devDependencies || {}, dep.checkedName.name, newVersion);
  }

  getManifestManager().writePackageManifest(mod.path, manifest);
}


function getCurrentPackageVersion(dir: string) {
  const manifest = getManifestManager().readPackageManifest(dir);
  return manifest.version;
}


async function getPublishedPackageMetaInfo(packageName: string, version: string): Promise<MetaInfo> {
  const publishedInfo = await getPublishedPackageInfo(`${ packageName }@${ version }`);
  if (!publishedInfo) {
    throw new Error(`Failed to get meta info for package that is expected to be published: ${ packageName }@${ version }`);
  }

  return {
    integrity: publishedInfo.integrity,
    resolved: publishedInfo.tarball
  };
}


async function pushChanges(dir: string, dryRun: boolean) {
  const args = [ "push", "origin", "--follow-tags" ];

  if (dryRun) {
    console.log("->", ...args);
  } else {
    await runCommand("git", args, {
      cwd: dir
    });
  }
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
  if (semver.prerelease(newVersion)) {
    return RECENT_TAG;
  }

  // set latest only if new version if greater than every other published version
  if (publishedInfo.versions.every(v => semver.lt(v, newVersion))) {
    return LATEST_TAG;
  }

  return RECENT_TAG;
}
