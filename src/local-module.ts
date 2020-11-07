import { getManifestManager } from "./manifest-manager";
import { isValidReleaseBranchesParam } from "./release/ensure-branches";


export interface ModuleNpmName {
  scope: string | undefined;
  pkg: string;
  name: string;
}


export interface LocalModuleConfig {
  path: string;
  name: ModuleNpmName | undefined;
  useNpm: boolean;
  releaseBranches?: string[];
}


export class LocalModule {
  public get name() {
    return this._config.name;
  }

  public get checkedName() {
    if (!this._config.name) {
      throw new Error(`Module at "${ this.path }" has no name defined`);
    }

    return this._config.name;
  }

  public get path() {
    return this._config.path;
  }

  public get useNpm() {
    return this._config.useNpm;
  }

  public get config() {
    return this._config;
  }


  public constructor(private _config: LocalModuleConfig) {

  }


  public static createFromPackage(packagePath: string): LocalModule {
    let manifest = getManifestManager().readPackageManifest(packagePath);
    if (!manifest) {
      return new LocalModule({
        path: packagePath,
        name: undefined,
        useNpm: false
      });
    } else {
      const releaseBranches = manifest.rollman?.releaseBranches;
      if (!isValidReleaseBranchesParam(releaseBranches)) {
        throw new Error(`Invalid "rollman.releaseBranches" param in ${ packagePath }/package.json: should be an array of strings`);
      }

      return new LocalModule({
        path: packagePath,
        name: npmNameFromPackageName(manifest.name),
        useNpm: true,
        releaseBranches
      });
    }
  }
}


export function npmNameFromPackageName(name: string): ModuleNpmName {
  if (name.indexOf("/") > 0) {
    let [ org, pkg ] = name.split("/");
    if (org.startsWith("@")) {
      org = org.slice(1);
    }
    return { scope: org, pkg, name: `@${ org }/${ pkg }` };
  } else {
    return { scope: undefined, pkg: name, name };
  }
}
