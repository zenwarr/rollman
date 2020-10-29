import * as columnify from "columnify";
import { walkAllLocalModules } from "../deps/dry-dependency-tree";
import { getManifestReader } from "../manifest-reader";


export async function listModulesCommand() {
  let data: any[] = [];

  await walkAllLocalModules(async module => {
    data.push({
      npmName: module.name ? module.name.name : "<no name>",
      path: module.path,
      useNpm: module.useNpm,
      version: module.path ? getManifestReader().readPackageManifest(module.path)?.version : ""
    });
  });

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
