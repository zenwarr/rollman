import { LocalModule } from "../local-module";
import { NpmRunner } from "../module-npm-runner";
import { Lockfile } from "../lockfile";
import { getDirectLocalDeps, walkModuleDependants } from "../deps/dry-dependency-tree";
import { getRegistry } from "../registry";
import * as path from "path";
import * as fs from "fs-extra";


export interface ModSpecifier {
  mod: LocalModule;
  version: string;
}


export async function updateDependencies(parent: LocalModule, children: ModSpecifier[]) {
  if (!children.length) {
    return;
  }

  let modulesDir = path.join(parent.path, "node_modules");
  if (!fs.existsSync(modulesDir)) {
    await NpmRunner.run(parent, "install");
  }

  let parts = children.map(child => `${ child.mod.checkedName.name }@${ child.version }`);

  await NpmRunner.run(parent, [ "install", ...parts ]);

  if (Lockfile.existsInModule(parent)) {
    let lockfile = Lockfile.forModule(parent);
    lockfile.updateResolveUrl(getRegistry().address);
  }
}


export async function updateModuleInDependants(actualVersion: string, mod: LocalModule) {
  await walkModuleDependants(mod, async dep => {
    let shouldBeInstalled = getDirectLocalDeps(dep).includes(mod);
    if (shouldBeInstalled) {
      await updateDependencies(dep, [
        {
          mod,
          version: actualVersion
        }
      ]);
    }
  });
}
