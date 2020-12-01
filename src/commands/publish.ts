import { walkModules } from "../dependencies";
import { LocalModule } from "../local-module";
import { changedSincePublish, dependsOnOneOf, openRepo } from "../git";
import { fork, getNpmExecutable, runCommand } from "../process";
import { getProject } from "../project";
import { getManifestManager } from "../manifest-manager";
import { generateLockFile } from "lockfile-generator";
import { MetaInfo } from "lockfile-generator/declarations/lib/MetaInfoResolver";
import { getPublishedPackageInfo } from "../registry";
import * as semver from "semver";


async function moduleShouldBePublished(mod: LocalModule, dirtyModules: LocalModule[]): Promise<boolean> {
  if (!mod.useNpm) {
    return false;
  }

  const repo = await openRepo(mod.path);
  if (!repo) {
    return false;
  }

  if (await changedSincePublish(mod)) {
    dirtyModules.push(mod);
    return true;
  }

  if (dependsOnOneOf(mod, dirtyModules)) {
    dirtyModules.push(mod);

    // there is no changes in current module, but it depends on some changed module.
    // in case this module requires lockfile generation, we should update it too.
    const bundledModules: string[] = getManifestManager().readPackageManifest(mod.path).rollman?.bundled;
    if (mod.alwaysUpdateLockFile || dirtyModules.some(dirty => bundledModules.includes(dirty.checkedName.name))) {
      return true;
    }
  }

  return false;
}


export async function publishCommand(): Promise<void> {
  const project = getProject();
  const toPublish: LocalModule[] = [];
  const dirtyModules: LocalModule[] = [];
  const localModulesMeta = new Map<string, MetaInfo>();

  await walkModules(async mod => {
    if (await moduleShouldBePublished(mod, dirtyModules)) {
      toPublish.push(mod);
    } else {
      localModulesMeta.set(mod.checkedName.name, await getPublishedPackageMetaInfo(mod.checkedName.name, getCurrentPackageVersion(mod.path)));
    }
  });

  for (const modToPublish of toPublish) {
    await fork(require.resolve("../release/semantic-version"), [ "--dir", modToPublish.path ]);

    if (project.options.useLockFiles && modToPublish.alwaysUpdateLockFile) {
      await generateLockFile(modToPublish.path, localModulesMeta);
    }

    // todo: bundle lockfile

    const manifest = getManifestManager().readPackageManifest(modToPublish.path);
    const newVersion = manifest.version;

    const publishTag = await getPublishTag(modToPublish.checkedName.name, newVersion);
    await runCommand(getNpmExecutable(), [ "publish", modToPublish.path, "--tag", publishTag, "--dry-run" ], {
      cwd: project.rootDir
    });

    localModulesMeta.set(modToPublish.checkedName.name, await getPublishedPackageMetaInfo(modToPublish.checkedName.name, newVersion));

    // await pushChanges(modToPublish);
  }
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


async function pushChanges(mod: LocalModule) {
  await runCommand("git", [ "push", "origin", "--tags" ], {
    cwd: mod.path
  });
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
