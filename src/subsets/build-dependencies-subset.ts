import { ModuleSubset } from "./module-subset";
import * as mimimatch from "minimatch";


/**
 * Subset of files that should trigger a module rebuild
 */
export class BuildDependenciesSubset extends ModuleSubset {
  public static getTag(): string {
    return "build";
  }


  public getName() {
    return BuildDependenciesSubset.getTag();
  }


  public async isFileIncluded(filename: string): Promise<boolean> {
    return this.mod.buildTriggers.some(pattern => mimimatch(filename, pattern, { matchBase: true }));
  }
}
