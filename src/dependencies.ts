import { LocalModule } from "./local-module";
import { getProject } from "./project";
import { getManifestManager } from "./manifest-manager";


export enum WalkerAction {
  Continue,
  Stop
}


export type ModuleWalker = (module: LocalModule) => Promise<WalkerAction | void> | WalkerAction | void;


export interface PackageDep {
  name: string;
  range: string;
  type: DepType;
}


export interface ModuleDep {
  mod: LocalModule;
  range: string;
  type: DepType;
}


export function getDirectModuleDeps(mod: LocalModule, includeDev: boolean = true): ModuleDep[] {
  const project = getProject();

  return getDirectPackageDeps(mod, includeDev).map(dep => ({
    mod: project.getModule(dep.name),
    range: dep.range,
    type: dep.type
  })).filter(dep => dep.mod != null) as ModuleDep[];
}


export function getDirectPackageDeps(mod: LocalModule, includeDev: boolean): PackageDep[] {
  let pkg = getManifestManager().readPackageManifest(mod.path);
  if (!pkg) {
    return [];
  }

  let result: PackageDep[] = [];

  function addDeps(obj: { [name: string]: string } | undefined, type: DepType) {
    if (!obj) {
      return;
    }

    for (let [ name, range ] of Object.entries(obj)) {
      result.push({
        name,
        range,
        type
      });
    }
  }

  addDeps(pkg.dependencies, DepType.Production);
  // addDeps(pkg.peerDependencies, DepType.Peer);
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
 * Walks all modules in project in topological order (dependency is always visited first)
 */
export async function walkModules(walker: ModuleWalker): Promise<void> {
  const walked = new Set<LocalModule>();

  const walkModule = async (mod: LocalModule, deps: LocalModule[], parents: LocalModule[]): Promise<WalkerAction> => {
    if (walked.has(mod)) {
      return WalkerAction.Continue;
    }

    for (let dep of deps) {
      if (!dep.name) {
        continue;
      }

      if (parents.indexOf(dep) >= 0) {
        throw new Error(`Recursive dependency: ${ dep.formattedName }, required by ${ parents.map(p => p.formattedName).join(" -> ") }`);
      }

      const action = await walkModule(dep, getDirectModuleDeps(dep).map(x => x.mod), [ ...parents, mod ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(mod);

    return await walker(mod) || WalkerAction.Continue;
  };

  for (let module of getProject().modules) {
    const action = await walkModule(module, getDirectModuleDeps(module).map(x => x.mod), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}
