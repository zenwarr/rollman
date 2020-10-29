import { getManifestReader } from "./manifest-reader";


export interface ModuleNpmName {
  scope: string | undefined;
  pkg: string;
  name: string;
}


export interface LocalModuleConfig {
  path: string;
  name: ModuleNpmName | undefined;
  useNpm: boolean;
}


export class LocalModule {
  public get config() {
    return this._config;
  }

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


  public constructor(private _config: LocalModuleConfig) {

  }


  public static readFromPackage(packagePath: string): LocalModule {
    let manifest = getManifestReader().readPackageManifest(packagePath);
    if (!manifest) {
      return new LocalModule({
        path: packagePath,
        name: undefined,
        useNpm: false
      });
    } else {
      return new LocalModule({
        path: packagePath,
        name: npmNameFromPackageName(manifest.name),
        useNpm: true
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
