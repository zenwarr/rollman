import { LocalModule } from "../local-module";
import { getDirectLocalDeps, walkAllLocalModules } from "../deps/dry-dependency-tree";
import * as columnify from "columnify";
import { getProject } from "../project";


export async function dependencyTreeCommand() {
  function getName(leaf: LocalModule) {
    return leaf.name ? leaf.name.name : `<no name> (${ leaf.path })`;
  }

  const project = getProject();
  let output: { name: string; "direct deps": string }[] = [];

  async function printModuleTree(leaf: LocalModule) {
    if (!leaf.useNpm) {
      return;
    }

    let deps = getDirectLocalDeps(leaf).map(x => getName(project.getModuleChecked(x.name)));
    let depsLine = deps.length ? `${ deps.join(", ") }` : "";

    output.push({
      name: getName(leaf),
      "direct deps": depsLine
    });
  }

  await walkAllLocalModules(printModuleTree);

  console.log(columnify(output, {
    columnSplitter: " | "
  }));
}
