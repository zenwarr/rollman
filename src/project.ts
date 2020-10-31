import { LocalModule } from "./local-module";
import * as path from "path";
import * as fs from "fs-extra";
import * as glob from "glob";
import { ServiceLocator } from "./locator";
import { getArgs } from "./arguments";
import { getManifestReader } from "./manifest-reader";


export interface ProjectOptions {
  useLockFiles: boolean;
  alwaysUpdateLockFile: boolean;
  useGitTags: boolean;
}


export class Project {
  public constructor(private _rootDir: string, private _modules: LocalModule[], private _options: ProjectOptions) {
  }

  public get modules() {
    return this._modules;
  }

  public get options() {
    return this._options;
  }

  public get rootDir() {
    return this._rootDir;
  }

  public getModule(moduleName: string): LocalModule | null {
    return this._modules.find(module => module.name && module.name.name === moduleName) || null;
  }

  public getModuleChecked(moduleName: string): LocalModule {
    let mod = this.getModule(moduleName);
    if (!mod) {
      throw new Error(`Module ${ moduleName } not found`);
    }

    return mod;
  }

  public getModuleByPath(modulePath: string): LocalModule | null {
    modulePath = fs.realpathSync(modulePath);
    return this._modules.find(mod => fs.realpathSync(mod.path) === modulePath) || null;
  }

  public static loadProject(startDir: string): Project {
    let projectDir = this.findProjectDir(startDir);
    let manifest = getManifestReader().readPackageManifest(projectDir);
    let patterns: string[] = typeof manifest.workspaces.packages === "string" ? [ manifest.workspaces.packages ] : manifest.workspaces.packages;

    let packagePaths = new Set<string>();
    for (let pattern of patterns) {
      let files = glob.sync(pattern, {
        cwd: projectDir
      });
      for (let filename of files) {
        packagePaths.add(path.join(projectDir, filename));
      }
    }

    let useLockFiles = manifest.rollman?.useLockFiles ?? false;
    if (typeof useLockFiles !== "boolean") {
      throw new Error(`rollman.useLockFiles should be a boolean in ${ projectDir }/package.json`);
    }

    let useGitTags = manifest.rollman?.useGitTags ?? true;
    if (typeof useGitTags !== "boolean") {
      throw new Error(`rollman.useGitTags should be a boolean in ${ projectDir }/package.json`);
    }

    let alwaysUpdateLockFile = manifest.rollman?.alwaysUpdateLockFile ?? false;
    if (typeof alwaysUpdateLockFile !== "boolean") {
      throw new Error(`rollman.alwaysUpdateLockFile should be a boolean in ${ projectDir }/package.json`);
    }

    let modules = [ ...packagePaths.values() ].map(packagePath => LocalModule.readFromPackage(packagePath));
    return new Project(projectDir, modules, {
      useLockFiles,
      useGitTags,
      alwaysUpdateLockFile
    });
  }


  public static findProjectDir(startDir: string): string {
    const findConfigForDir = (dir: string): string => {
      if (!dir || dir === "/" || dir === ".") {
        throw new Error("No package.json with workspaces enabled found in directory tree");
      }

      if (fs.existsSync(dir) && isWorkspaceEnabled(dir)) {
        return dir;
      } else {
        return findConfigForDir(path.dirname(dir));
      }
    };

    return findConfigForDir(startDir);
  }


  public static init() {
    const args = getArgs();
    const project = Project.loadProject(args.config || process.cwd());
    ServiceLocator.instance.initialize("project", project);
  }
}


function isWorkspaceEnabled(manifestPath: string) {
  let manifest = getManifestReader().readPackageManifest(manifestPath);
  return !!(manifest && manifest.workspaces);
}


export function getProject() {
  return ServiceLocator.instance.get<Project>("project");
}


