import { LocalModule } from "../local-module";
import { NpmRunner } from "../module-npm-runner";
import { Lockfile } from "../lockfile";
import * as path from "path";
import * as fs from "fs-extra";


export interface ModSpecifier {
  mod: LocalModule;
  version: string;
}


export async function installDependencies(into: LocalModule, modules: ModSpecifier[]) {
  if (!modules.length) {
    return;
  }

  // if no `node_modules` exist before we install dependencies, only specified dependencies are going to be installed,
  // and `node_modules` is going to be incomplete.
  let modulesDir = path.join(into.path, "node_modules");
  if (!fs.existsSync(modulesDir)) {
    await NpmRunner.run(into, "install");
  }

  let parts = modules.map(child => `${ child.mod.checkedName.name }@${ child.version }`);

  await NpmRunner.run(into, [ "install", ...parts ]);

  if (Lockfile.existsInModule(into)) {
    let lockfile = Lockfile.forModule(into);
    lockfile.update();
  }
}
