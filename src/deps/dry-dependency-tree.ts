import { LocalModule } from "../local-module";
import { getProject } from "../project";
import { getPackageReader } from "../package-reader";


export enum WalkerAction {
  Continue,
  Stop
}


export type LocalModuleWalker = (module: LocalModule) => Promise<WalkerAction | void>;


export function getDirectDeps(packagePath: string, includeDev: boolean = true): string[] {
  let pkg = getPackageReader().readPackageMetadata(packagePath);
  if (!pkg) {
    return [];
  }

  let deps = Object.keys(pkg.dependencies || {});
  if (includeDev) {
    deps = deps.concat(Object.keys(pkg.devDependencies || {}));
  }

  return deps;
}


/**
 * Returns list of all local modules listed in `dependencies` and `devDependencies` of the given module.
 * @param module
 */
export function getDirectLocalDeps(module: LocalModule): LocalModule[] {
  if (!module.useNpm) {
    return [];
  }

  const project = getProject();
  return getDirectDeps(module.path).map(moduleName => project.getModuleInfo(moduleName)).filter(dep => dep != null) as LocalModule[];
}


export async function walkModuleDependants(mod: LocalModule, walker: (dep: LocalModule) => Promise<void>, walked?: Set<LocalModule>): Promise<void> {
  let config = getProject();

  let dependants: LocalModule[] = [];

  if (!walked) {
    walked = new Set<LocalModule>();
  }

  for (let anotherMod of config.modules) {
    let directDeps = getDirectLocalDeps(anotherMod);
    if (directDeps.includes(mod) && (!walked || !walked.has(anotherMod))) {
      await walker(anotherMod);
      walked.add(anotherMod);
      dependants.push(anotherMod);
    }
  }

  for (let dep of dependants) {
    await walkModuleDependants(dep, walker, walked);
  }
}


export async function walkAllLocalModules(walker: LocalModuleWalker): Promise<void> {
  const walked = new Set<LocalModule>();

  const walkModule = async(mod: LocalModule, deps: LocalModule[], parents: LocalModule[]): Promise<WalkerAction> => {
    if (walked.has(mod)) {
      return WalkerAction.Continue;
    }

    for (let dep of deps) {
      if (!dep.name) {
        continue;
      }

      if (parents.indexOf(dep) >= 0) {
        throw new Error(`Recursive dependency: ${ dep.name }, required by ${ parents.join(" -> ") }`);
      }

      const action = await walkModule(dep, getDirectLocalDeps(dep), [ ...parents, mod ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(mod);

    return await walker(mod) || WalkerAction.Continue;
  };

  for (let module of getProject().modules) {
    const action = await walkModule(module, getDirectLocalDeps(module), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}
