import { LocalModule } from "../local-module";
import { getDirectModuleDeps, walkModules } from "../dependencies";
import * as columnify from "columnify";


export async function dependencyTreeCommand() {
  function getName(leaf: LocalModule) {
    return leaf.name ? leaf.name.name : `<no name> (${ leaf.path })`;
  }

  let output: { name: string; "direct deps": string }[] = [];

  async function printModuleTree(leaf: LocalModule) {
    if (!leaf.useNpm) {
      return;
    }

    let deps = getDirectModuleDeps(leaf).map(x => x.mod.checkedName.name);
    let depsLine = deps.length ? `${ deps.join(", ") }` : "";

    output.push({
      name: getName(leaf),
      "direct deps": depsLine
    });
  }

  await walkModules(printModuleTree);

  console.log(columnify(output, {
    columnSplitter: " | "
  }));
}
