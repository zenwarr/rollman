import {getArgs} from "../arguments";
import {LocalModule} from "../local-module";
import {NpmRegistry} from "../registry";
import {getDirectLocalDeps, walkAllLocalModules, WalkerAction} from "../deps/dry-dependency-tree";
import {installDependencies, ModSpecifier} from "../sync/update-deps";
import {publishModuleForRelease} from "../sync/publish";
import {getNpmInfoReader} from "../npm-info-reader";
import {PublishInfo} from "../sync/sync-command";


export async function releaseCommand() {
  let args = getArgs();

  if (args.subCommand !== "release") {
    throw new Error("Expected release");
  }

  await NpmRegistry.init();

  let releaseType = args.releaseType;

  let publishInfo = new Map<LocalModule, PublishInfo>();
  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return WalkerAction.Continue;
    }

    let depsToUpdate: ModSpecifier[] = []; // in this array we keep info on which modules update and which version to install
    for (let localDep of getDirectLocalDeps(mod)) {
      if (publishInfo.has(localDep)) {
        depsToUpdate.push({
          mod: localDep,
          version: publishInfo.get(localDep)!.publishedVersion
        });
      }
    }

    await installDependencies(mod, depsToUpdate);

    let publishedVersion = await publishModuleForRelease(mod, releaseType);
    if (publishedVersion) {
      publishInfo.set(mod, {
        publishedVersion,
        info: await getNpmInfoReader().getNpmInfo(mod)
      });
    }

    return WalkerAction.Continue;
  });
}
