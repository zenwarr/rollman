import * as fs from "fs-extra";
import { LocalModule } from "../local-module";
import { DepType, ModuleDep } from "../dependencies";
import { getProject } from "../project";
import { cancelRelease, ReleaseContext } from "./release-context";
import { getManifestReader } from "../manifest-reader";
import * as semver from "semver";
import * as prompts from "prompts";
import * as chalk from "chalk";
import { generateLockFile } from "lockfile-generator";
import { hasUncommittedChanges, stageAllAndCommit } from "./git";


function getDepKey(type: DepType) {
  switch (type) {
  case DepType.Production:
    return "dependencies";
  case DepType.Dev:
    return "devDependencies";
  case DepType.Peer:
    return "peerDependencies";
  }
}


function setDependencyRanges(source: LocalModule, deps: ModuleDep[]) {
  const manifestReader = getManifestReader();
  const manifest = manifestReader.readPackageManifest(source.path);

  for (const dep of deps) {
    const depKey = getDepKey(dep.type);
    if (!(depKey in manifest)) {
      manifest[depKey] = {};
    }

    manifest[depKey][dep.mod.checkedName.name] = dep.range;
  }

  fs.writeFileSync(manifestReader.getPackageManifestPath(source.path), JSON.stringify(manifest, null, 2), "utf-8");
  manifestReader.invalidate(source.path);
}


async function askForRange(mod: LocalModule, dep: ModuleDep, currentDepVersion: string): Promise<string> {
  const modName = mod.checkedName.name;
  const depName = dep.mod.checkedName.name;
  const currentDepRange = dep.range;

  let newRange = await prompts({
    type: "select",
    name: "value",
    message: `${ modName } depends on ${ depName }@${ chalk.yellow(currentDepRange) }, but ${ depName }@${ chalk.red(currentDepVersion) } no longer matches this requirement. We need to change semver range`,
    choices: [
      {
        title: `${ modName } is compatible with all versions of ${ depName } in range ${ currentDepRange }`,
        value: `${ currentDepRange } || ^${ currentDepVersion }`,
        description: `${ currentDepRange } || ^${ currentDepVersion }`
      },
      {
        title: `${ modName } is compatible only with versions starting from ${ currentDepVersion }`,
        value: `^${ currentDepVersion }`,
        description: `^${ currentDepVersion }`
      }
    ]
  }, { onCancel: cancelRelease });

  return newRange.value;
}


export async function updateDependencies(ctx: ReleaseContext, mod: LocalModule, localDeps: ModuleDep[]) {
  let rangesToUpdate: ModuleDep[] = [];
  for (let dep of localDeps) {
    const depManifest = getManifestReader().readPackageManifest(dep.mod.path);
    const depVersion = depManifest.version;

    console.log("dep version: ", depVersion);

    if (!semver.satisfies(depVersion, dep.range)) {
      const newRange = await askForRange(mod, dep, depVersion);

      rangesToUpdate.push({
        mod: dep.mod,
        range: newRange,
        type: dep.type
      });
    }
  }

  setDependencyRanges(mod, rangesToUpdate);

  const project = getProject();
  if (project.options.useLockFiles) {
    const manifest = getManifestReader().readPackageManifest(mod.path);
    const alwaysUpdateLockFile = manifest.rollman?.alwaysUpdateLockFile ?? getProject().options.alwaysUpdateLockFile;

    if (rangesToUpdate.length || alwaysUpdateLockFile) {
      await generateLockFile(mod.path);
    }
  }

  const repo = await ctx.getRepo(mod);
  if (repo && await hasUncommittedChanges(repo)) {
    await stageAllAndCommit(mod, "chore: update dependencies");
  }
}
