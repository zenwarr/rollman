import { LocalModule } from "./local-module";
import * as path from "path";
import * as fs from "fs-extra";
import * as chalk from "chalk";
import { PublishDependenciesSubset } from "./subsets/publish-dependencies-subset";
import { ModuleSubset } from "./subsets/module-subset";
import { getPackageReader } from "./package-reader";


function isSymlink(filename: string): boolean {
  return fs.lstatSync(filename).isSymbolicLink();
}


function getRidOfIt(filename: string): void {
  let stat: fs.Stats;

  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  (stat.isDirectory() ? fs.rmdirSync : fs.unlinkSync)(filename);
}


function hasExecPermission(filename: string): boolean {
  if (process.platform === "win32") {
    return false;
  } else {
    try {
      fs.accessSync(filename, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }
}


async function copyFile(source: string, target: string, isExecutable: boolean): Promise<void> {
  // here we always copy a file by loading it into memory because fs.copyFile has problems on VirtualBox shared folders
  let fileContent = fs.readFileSync(source);
  fs.writeFileSync(target, fileContent, { mode: (isExecutable ? 0o0100 : 0) | 0o666 });
}


async function walkDirectoryFiles(startDir: string, walker: (filename: string, stat: fs.Stats) => Promise<void>): Promise<void> {
  const handle = async(filename: string) => {
    let stat: fs.Stats;

    try {
      stat = fs.statSync(filename);
    } catch (error) {
      return;
    }

    await walker(filename, stat);

    if (stat.isDirectory()) {
      let items = fs.readdirSync(filename);
      for (let item of items) {
        await handle(path.join(filename, item));
      }
    }
  };

  await handle(startDir);
}


export async function quickSync(source: LocalModule, targetDir: string, targetName: string) {
  if (isSymlink(targetDir)) {
    console.log(chalk.yellow(`Skipping sync into "${ targetDir }" because it is a linked dependency`));
    return;
  }

  let filesCopied = 0;

  let publishSubset = new PublishDependenciesSubset(source);
  await publishSubset.walk(async(filename: string, stat: fs.Stats) => {
    let target = path.join(targetDir, path.relative(source.path, filename));

    if (!stat.isDirectory()) {
      let doCopy: boolean;

      let targetStat: fs.Stats | null = null;
      try {
        targetStat = fs.statSync(target);
        doCopy = stat.mtime.valueOf() > targetStat.mtime.valueOf();
      } catch (error) {
        doCopy = error.code === "ENOENT";
        if (error.code !== "ENOENT") {
          console.log(chalk.red(`Error while copying to ${ target }: ${ error.message }`));
        }
      }

      if (doCopy) {
        let parentDestDir = path.dirname(target);
        if (!fs.existsSync(parentDestDir)) {
          fs.mkdirpSync(parentDestDir);
        }

        let isTargetExecutable = hasExecPermission(target);

        getRidOfIt(target);

        await copyFile(filename, target, isTargetExecutable);

        ++filesCopied;
      }
    } else {
      let doCreate = false;

      let targetStat: fs.Stats | null = null;

      try {
        targetStat = fs.lstatSync(target);
      } catch (error) {
        // assume it does not exists
        doCreate = true;
      }

      if (targetStat) {
        if (targetStat.isDirectory()) {
          // skip
        } else {
          fs.unlinkSync(target);
          doCreate = true;
        }
      }

      if (doCreate) {
        fs.mkdirpSync(target);

        ++filesCopied;
      }
    }
  });

  let { removed, failed } = await quickSyncRemove(source, publishSubset, targetDir);

  if (filesCopied || removed || failed) {
    let from = chalk.green(source.checkedName.name);
    let into = chalk.green(targetName);
    console.log(`${ from } -> ${ into }: copied ${ filesCopied }, removed ${ removed }, failed to remove ${ failed }`);
  }
}


export function canQuickSync(source: LocalModule, target: string): boolean {
  if (fs.existsSync(target)) {
    return false;
  }

  let sourceManifest = getPackageReader().readPackageMetadata(source.path);
  if (!sourceManifest) {
    return true;
  }

  let targetManifest = getPackageReader().readPackageMetadata(target);
  if (!targetManifest) {
    return false;
  }

  return !(sourceManifest.name !== targetManifest.name || sourceManifest.version !== targetManifest.version || !depsEqual(sourceManifest.dependencies, targetManifest.dependencies) || !depsEqual(sourceManifest.devDependencies, targetManifest.devDependencies));
}


function depsEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) {
    return true;
  }

  if (a == null || b == null) {
    return false;
  }

  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  let aKeys = Object.keys(a as object),
      bKeys = Object.keys(b as object);
  aKeys.sort();
  bKeys.sort();

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (let q = 0; q < aKeys.length; ++q) {
    if (aKeys[q] !== bKeys[q] || (a as any)[aKeys[q]] !== (b as any)[aKeys[q]]) {
      return false;
    }
  }

  return true;
}


async function quickSyncRemove(source: LocalModule, subset: ModuleSubset, syncTarget: string) {
  let filesToRemove: [ string, fs.Stats ][] = [];
  let removedCount = 0, failedCount = 0;

  await walkDirectoryFiles(syncTarget, async(filename, stat) => {
    let relpath = path.relative(syncTarget, filename);

    let sourceFilename = path.join(source.path, relpath);
    if (!fs.existsSync(sourceFilename) || !await subset.isFileIncluded(sourceFilename)) {
      filesToRemove.push([ filename, stat ]);
    }
  });

  for (let item of filesToRemove) {
    try {
      if (item[1].isDirectory()) {
        fs.removeSync(item[0]);
      } else {
        fs.unlinkSync(item[0]);
      }
      ++removedCount;
    } catch (error) {
      ++failedCount;
      // console.log(`Failed to remove "${ item[0] }]: ${ error.message }`);
    }
  }

  return {
    removed: removedCount,
    failed: failedCount
  };
}
