import * as columnify from "columnify";
import { getRegistryForPackage } from "../registry-paths";
import { walkAllLocalModules } from "../deps/dry-dependency-tree";
import { getPackageReader } from "../package-reader";


export async function listModulesCommand() {
  let data: any[] = [];

  await walkAllLocalModules(async module => {
    data.push({
      name: module.name ? module.name.name : "<no name>",
      path: module.path,
      registry: module.name ? getRegistryForPackage(module.name) : "<not fetched>",
      useNpm: module.useNpm,
      version: module.path ? getPackageReader().readPackageMetadata(module.path)?.version : ""
    });
  });

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
