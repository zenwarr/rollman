import { LocalModule } from "./local-module";
import { getProject } from "./project";
import { getManifestReader } from "./manifest-reader";


export enum WalkerAction {
  Continue,
  Stop
}


export type ModuleWalker = (module: LocalModule) => Promise<WalkerAction | void>;


export interface ModuleDep {
  mod: LocalModule;
  range: string;
  type: DepType;
}


export function getDirectDeps(mod: LocalModule, includeDev: boolean = true): ModuleDep[] {
  const project = getProject();

  let pkg = getManifestReader().readPackageManifest(mod.path);
  if (!pkg) {
    return [];
  }

  let result: ModuleDep[] = [];

  function addDeps(obj: { [name: string]: string } | undefined, type: DepType) {
    if (!obj) {
      return;
    }

    for (let [ key, value ] of Object.entries(obj)) {
      const localModule = project.getModule(key);
      if (!localModule) {
        continue;
      }

      result.push({
        mod: localModule,
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
        throw new Error(`Recursive dependency: ${ dep.name }, required by ${ parents.join(" -> ") }`);
      }

      const action = await walkModule(dep, getDirectDeps(dep).map(x => x.mod), [ ...parents, mod ]);
      if (action === WalkerAction.Stop) {
        return WalkerAction.Stop;
      }
    }

    walked.add(mod);

    return await walker(mod) || WalkerAction.Continue;
  };

  for (let module of getProject().modules) {
    const action = await walkModule(module, getDirectDeps(module).map(x => x.mod), []);
    if (action === WalkerAction.Stop) {
      return;
    }
  }
}
