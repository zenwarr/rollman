import columnify from "columnify";
import { walkModules } from "../dependencies";
import { getManifestManager } from "../manifest-manager";


export async function listModulesCommand() {
  let data: any[] = [];

  await walkModules(async module => {
    data.push({
      npmName: module.name ? module.name.name : "<no name>",
      path: module.path,
      useNpm: module.useNpm,
      version: module.path ? getManifestManager().readPackageManifest(module.path)?.version : ""
    });
  });

  console.log(columnify(data, {
    columnSplitter: " | "
  }));
}
