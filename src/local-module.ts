import { getManifestManager } from "./manifest-manager";


export interface ModuleNpmName {
  scope: string | undefined;
  pkg: string;
  name: string;
}


export interface LocalModuleConfig {
  path: string;
  name: ModuleNpmName | undefined;
  useNpm: boolean;
  publishIfSourceNotChanged?: boolean;
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


  public get formattedName() {
    return this._config.name ? this._config.name.name : this.path;
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


  public get alwaysUpdateLockFile(): boolean {
    const manifest = getManifestManager().readPackageManifest(this.path);
    return manifest.rollman?.alwaysUpdateLockFile === true;
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
      const publishIfSourceNotChanged = manifest.rollman?.publishIfSourceNotChanged;
      if (publishIfSourceNotChanged != null && typeof publishIfSourceNotChanged !== "boolean") {
        throw new Error(`Invalid "rollman.publishIfSourceNotChanged" param in ${ packagePath }/package.json: should be a boolean`);
      }

      return new LocalModule({
        path: packagePath,
        name: npmNameFromPackageName(manifest.name),
        useNpm: true,
        publishIfSourceNotChanged
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
