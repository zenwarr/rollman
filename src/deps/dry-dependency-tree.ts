import { LocalModule } from "../local-module";
import { getProject } from "../project";
import { getManifestReader } from "../manifest-reader";


export enum WalkerAction {
  Continue,
  Stop
}


export type LocalModuleWalker = (module: LocalModule) => Promise<WalkerAction | void>;


export interface ModuleDep {
  name: string;
  range: string;
  type: DepType;
}


export function getDirectDeps(packagePath: string, includeDev: boolean = true): ModuleDep[] {
  let pkg = getManifestReader().readPackageManifest(packagePath);
  if (!pkg) {
    return [];
  }

  let result: ModuleDep[] = [];

  function addDeps(obj: { [name: string]: string } | undefined, type: DepType) {
    if (!obj) {
      return;
    }

    for (let [ key, value ] of Object.entries(obj)) {
      result.push({
        name: key,
        range: value,
        type
      });
    }
  }

  addDeps(pkg.dependencies, DepType.Production);
  addDeps(pkg.peerDependencies, DepType.Peer);
  if (includeDev) {
    addDeps(pkg.devDependencies, DepType.Dev);
  }

  return result;
}


export enum DepType {
  Production,
  Dev,
  Peer,
}


/**
 * Returns list of all local modules listed in `dependencies` and `devDependencies` of the given module.
 * @param module
 */
export function getDirectLocalDeps(module: LocalModule): ModuleDep[] {
  if (!module.useNpm) {
    return [];
  }

  const project = getProject();
  return getDirectDeps(module.path).filter(x => project.getModule(x.name) != null);
}


export async function walkAllLocalModules(walker: LocalModuleWalker): Promise<void> {
  const walked = new Set<LocalModule>();
  const project = getProject();

  const walkModule = async (mod: LocalModule, deps: LocalModule[], parents: LocalModule[]): Promise<WalkerAction> => {
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

      const action = await walkModule(dep, getDirectLocalDeps(dep).map(x => project.getModuleChecked(x.name)), [ ...parents, mod ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(mod);

    return await walker(mod) || WalkerAction.Continue;
  };

  for (let module of getProject().modules) {
    const action = await walkModule(module, getDirectLocalDeps(module).map(x => project.getModuleChecked(x.name)), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}
