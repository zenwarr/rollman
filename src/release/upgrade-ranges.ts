import { LocalModule } from "../local-module";
import { DepType, ModuleDep } from "../dependencies";
import { getProject } from "../project";
import { getYarnExecutable, runCommand } from "../process";
import { cancelRelease, ReleaseContext } from "./release-context";
import { getManifestReader } from "../manifest-reader";
import * as semver from "semver";
import * as prompts from "prompts";
import * as chalk from "chalk";
import { generateLockFile } from "lockfile-generator";
import { hasUncommittedChanges, stageAllAndCommit } from "./git";


async function installDeps(into: LocalModule, deps: ModuleDep[], type: DepType): Promise<void> {
  if (!deps.length) {
    return;
  }

  const project = getProject();
  const args = deps.map(dep => `${ dep.mod.checkedName.name }@"${ dep.range }"`);

  let saveFlag: string;
  switch (type) {
  case DepType.Dev:
    saveFlag = "--dev";
    break;

  case DepType.Production:
    saveFlag = "";
    break;

  case DepType.Peer:
    saveFlag = "--peer";
    break;
  }
  if (saveFlag !== "") {
    args.push(saveFlag);
  }

  await runCommand(getYarnExecutable(), [ "workspace", into.checkedName.name, "add", ...args ], {
    cwd: project.rootDir
  });
}


async function askForRange(mod: LocalModule, dep: ModuleDep, newDepVersion: string): Promise<string> {
  const modName = mod.checkedName.name;
  const depName = dep.mod.checkedName.name;
  const currentDepRange = dep.range;

  let newRange = await prompts({
    type: "select",
    name: "value",
    message: `${ modName } depends on ${ depName }@${ chalk.yellow(currentDepRange) }, but ${ depName }@${ chalk.red(newDepVersion) } no longer matches this requirement. We need to change semver range`,
    choices: [
      {
        title: `${ modName } is compatible with all versions of ${ depName } in range ${ currentDepRange }`,
        value: `${ currentDepRange } || ^${ newDepVersion }`,
        description: `${ currentDepRange } || ^${ newDepVersion }`
      },
      {
        title: `${ modName } is compatible only with versions starting from ${ newDepVersion }`,
        value: `^${ newDepVersion }`,
        description: `^${ newDepVersion }`
      }
    ]
  }, { onCancel: cancelRelease });

  return newRange.value;
}


export async function updateDependencies(ctx: ReleaseContext, mod: LocalModule, localDeps: ModuleDep[]) {
  let rangesToUpdate: ModuleDep[] = [];
  for (let dep of localDeps) {
    let updateInfo = ctx.updated.get(dep.mod);
    if (!updateInfo) {
      continue;
    }

    if (!semver.satisfies(updateInfo.to, dep.range)) {
      const newRange = await askForRange(mod, dep, updateInfo.to);

      rangesToUpdate.push({
        mod: dep.mod,
        range: newRange,
        type: dep.type
      });
    }
  }

  await installDeps(mod, rangesToUpdate.filter(x => x.type === DepType.Production), DepType.Production);
  await installDeps(mod, rangesToUpdate.filter(x => x.type === DepType.Dev), DepType.Dev);
  await installDeps(mod, rangesToUpdate.filter(x => x.type === DepType.Peer), DepType.Peer);

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
