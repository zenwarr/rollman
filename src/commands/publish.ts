import { walkModules } from "../dependencies";
import { LocalModule } from "../local-module";
import { changedSincePublish, dependsOnOneOf, isGitRepo } from "../git";
import { fork, getNpmExecutable, runCommand } from "../process";
import { getProject } from "../project";
import { getManifestManager } from "../manifest-manager";
import { generateLockFile } from "lockfile-generator";
import { MetaInfo } from "lockfile-generator/declarations/lib/MetaInfoResolver";
import { getPublishedPackageInfo } from "../registry";
import * as semver from "semver";
import { getArgs } from "../arguments";
import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";


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


export async function publishCommand(): Promise<void> {
  const project = getProject();
  const toPublish: LocalModule[] = [];
  const dirtyModules: LocalModule[] = [];
  const localModulesMeta = new Map<string, MetaInfo>();

  const args = getArgs();
  assert(args.subCommand === "publish");

  await walkModules(async mod => {
    if (await moduleShouldBePublished(mod, dirtyModules)) {
      toPublish.push(mod);
    } else {
      console.log(`Module ${ mod.formattedName } has no changes since last published version, skipping`);
      localModulesMeta.set(
          mod.checkedName.name,
          await getPublishedPackageMetaInfo(mod.checkedName.name, getCurrentPackageVersion(mod.path))
      );
    }
  });

  for (const mod of toPublish) {
    await fork(require.resolve("../release/semantic-version"), [ "--dir", mod.path ]);

    if (project.options.useLockFiles && mod.alwaysUpdateLockFile && args.lockfileCopyPath) {
      await generateLockFile(mod.path, localModulesMeta);

      const parentDir = path.dirname(args.lockfileCopyPath);
      if (parentDir !== ".") {
        fs.mkdirSync(path.join(mod.path, parentDir), { recursive: true });
      }
      fs.copyFileSync(path.join(mod.path, "package-lock.json"), path.join(mod.path, args.lockfileCopyPath));
    }

    // localModulesMeta.set(mod.checkedName.name, await getPublishedPackageMetaInfo(mod.checkedName.name, newVersion));
  }

  for (const mod of toPublish) {
    await pushChanges(mod);
  }

  for (const mod of toPublish) {
    const manifest = getManifestManager().readPackageManifest(mod.path);
    const newVersion = manifest.version;

    const publishTag = await getPublishTag(mod.checkedName.name, newVersion);
    await runCommand(getNpmExecutable(), [ "publish", mod.path, "--tag", publishTag ], {
      cwd: project.rootDir
    });
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
  await runCommand("git", [ "push", "origin", "--follow-tags" ], {
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
