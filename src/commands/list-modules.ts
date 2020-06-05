import * as columnify from "columnify";
import { getRegistryForPackage } from "../registry-paths";
import { walkAllLocalModules } from "../deps/dry-dependency-tree";


export async function listModulesCommand() {
  let data: any[] = [];

  await walkAllLocalModules(async module => {
    data.push({
      name: module.name ? module.name.name : "<no name>",
      path: module.path,
      registry: module.name ? getRegistryForPackage(module.name) : "<not fetched>",
      useNpm: module.useNpm
    });
  });

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
