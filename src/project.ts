import { LocalModule } from "./local-module";
import * as path from "path";
import * as fs from "fs-extra";
import * as chalk from "chalk";
import { ServiceLocator } from "./locator";
import { getArgs } from "./arguments";


const CONFIG_FILE_NAME = "norman.json";


interface RawConfig {
  modules?: unknown;
  modulesDirectory?: unknown;
  includeModules?: unknown;
  defaultNpmIgnore?: unknown;
  defaultIgnoreScope?: unknown;
  defaultBranch?: unknown;
  defaultUseNpm?: unknown;
  defaultBuildTriggers?: unknown;
}


interface ProjectConfigInit {
  mainProjectDir: string;
  mainModulesDir: string;
  defaultIgnoreScope: boolean;
  defaultNpmIgnorePath: string | undefined;
  defaultBranch: string;
  defaultUseNpm: boolean;
  defaultBuildTriggers: string[];
}


export class Project {
  private _modules: LocalModule[] = [];

  public get mainProjectDir() {
    return this._project.mainProjectDir;
  }

  public get defaultBranch() {
    return this._project.defaultBranch;
  }

  public get defaultIgnoreScope() {
    return this._project.defaultIgnoreScope;
  }

  public get defaultNpmIgnore() {
    return this._project.defaultNpmIgnorePath;
  }

  public get defaultUseNpm() {
    return this._project.defaultUseNpm;
  }

  public get defaultBuildTriggers() {
    return this._project.defaultBuildTriggers;
  }

  public get modules() {
    return this._modules;
  }

  protected constructor(private _project: ProjectConfigInit) {

  }


  public getModuleInfo(moduleName: string): LocalModule | null {
    return this._modules.find(module => module.name && module.name.name === moduleName) || null;
  }


  public static loadProject(projectFilename: string, rawConfig: RawConfig, isMainConfig: boolean, ignoreMissing: boolean): Project {
    let mainProjectDir = path.dirname(projectFilename);

    let mainModulesDir: string;
    if ("modulesDirectory" in rawConfig) {
      if (typeof rawConfig.modulesDirectory !== "string") {
        throw new Error("'modulesDirectory' should be a string");
      }
      if (!path.isAbsolute(rawConfig.modulesDirectory)) {
        mainModulesDir = path.resolve(mainProjectDir, rawConfig.modulesDirectory);
      } else {
        mainModulesDir = rawConfig.modulesDirectory;
      }
    } else {
      throw new Error("'modulesDirectory' is missing");
    }

    let defaultIgnoreScope = false;
    if ("defaultIgnoreScope" in rawConfig) {
      if (typeof rawConfig.defaultIgnoreScope !== "boolean") {
        throw new Error("'defaultIgnoreScope' should be a boolean");
      }
      defaultIgnoreScope = rawConfig.defaultIgnoreScope;
    }

    let defaultNpmIgnorePath: string | undefined;
    if ("defaultNpmIgnore" in rawConfig) {
      if (typeof rawConfig.defaultNpmIgnore !== "string") {
        throw new Error("'defaultNpmIgnore' should be a string");
      }
      defaultNpmIgnorePath = rawConfig.defaultNpmIgnore;
    }

    let defaultBranch = "master";
    if ("defaultBranch" in rawConfig) {
      if (typeof rawConfig.defaultBranch !== "string") {
        throw new Error("'defaultBranch' should be a string");
      }
      defaultBranch = rawConfig.defaultBranch;
    }

    let defaultUseNpm = true;
    if ("defaultUseNpm" in rawConfig) {
      if (typeof rawConfig.defaultUseNpm !== "boolean") {
        throw new Error("'defaultUseNpm' should be a string");
      }
      defaultUseNpm = rawConfig.defaultUseNpm;
    }

    let defaultBuildTriggers: string[] = [];
    if ("defaultBuildTriggers" in rawConfig) {
      if (!Array.isArray(rawConfig.defaultBuildTriggers)) {
        throw new Error("'defaultBuildTriggers' should be an array of strings");
      }
      defaultBuildTriggers = rawConfig.defaultBuildTriggers;
    }

    let appConfig = new Project({
      mainProjectDir,
      mainModulesDir,
      defaultIgnoreScope,
      defaultNpmIgnorePath,
      defaultBranch,
      defaultUseNpm,
      defaultBuildTriggers
    });

    appConfig._modules = this.loadModules(projectFilename, rawConfig, appConfig, isMainConfig, ignoreMissing);

    return appConfig;
  }


  private static loadModules(configFilename: string, rawConfig: RawConfig, appConfig: Project, isMainConfig: boolean, ignoreMissing: boolean): LocalModule[] {
    let configDir = path.dirname(configFilename);

    let modules: LocalModule[] = [];
    if ("includeModules" in rawConfig) {
      let includeModules: unknown[] = [];
      if (typeof rawConfig.includeModules === "string") {
        includeModules = [ rawConfig.includeModules ];
      } else if (Array.isArray(rawConfig.includeModules)) {
        includeModules = rawConfig.includeModules as string[];
      } else {
        throw new Error("'includeModules' should be an array or a string");
      }

      for (const includeModule of includeModules) {
        if (typeof includeModule !== "string") {
          throw new Error("'includeModules' should be an array of strings");
        }

        let configPath = includeModule;

        if (!path.isAbsolute(includeModule)) {
          configPath = path.resolve(configDir, configPath);
        }

        let configPathStat: fs.Stats;
        try {
          configPathStat = fs.statSync(configPath);
        } catch (error) {
          if (ignoreMissing) {
            console.log(chalk.yellow(`Ignoring "includeModules" for "${ configPath }", configuration file does not exist`));
            continue;
          } else {
            throw new Error(`Failed to include config at ${ configPath }: ${ error.message }`);
          }
        }

        if (configPathStat.isDirectory()) {
          configPath = path.join(configPath, CONFIG_FILE_NAME);
        }

        try {
          let config = Project.loadConfigFromFile(configPath, false, ignoreMissing);

          let extraModules = config._modules.filter(extraModule => !modules.find(module => module.name === extraModule.name));

          modules = modules.concat(extraModules);
        } catch (error) {
          throw new Error(`Failed to include modules from config at "${ configPath }" (while parsing config at "${ configFilename }": ${ error.message }`);
        }
      }
    }

    if ("modules" in rawConfig) {
      if (!Array.isArray(rawConfig.modules)) {
        throw new Error("'modules' should be an array");
      }

      for (let rawModule of rawConfig.modules) {
        if (!rawModule || typeof rawModule !== "object") {
          throw new Error("'modules' should be an array of objects");
        }

        modules.push(LocalModule.createFromConfig(rawModule, appConfig, isMainConfig, configDir));
      }
    }

    return modules;
  }


  public static findAndLoadProject(startDir: string, ignoreMissing: boolean): Project {
    const findConfigForDir = (dir: string): string => {
      if (!dir || dir === "/" || dir === ".") {
        throw new Error(`No ${ CONFIG_FILE_NAME } found in directory tree`);
      }

      let configLocation = path.join(dir, CONFIG_FILE_NAME);
      if (fs.existsSync(configLocation)) {
        return configLocation;
      } else {
        return findConfigForDir(path.dirname(dir));
      }
    };

    return this.loadConfigFromFile(findConfigForDir(startDir), true, ignoreMissing);
  }


  public static loadConfigFromFile(filename: string, isMainConfig: boolean, ignoreMissing: boolean): Project {
    let rawConfig = fs.readFileSync(filename, {
      encoding: "utf-8"
    });

    try {
      return this.loadProject(filename, JSON.parse(rawConfig), isMainConfig, ignoreMissing);
    } catch (error) {
      // invalid config, stop here
      throw new Error(`Invalid config file ${ filename }: ${ error.message }`);
    }
  }


  public static init() {
    const args = getArgs();
    const config = Project.findAndLoadProject(args.config || process.cwd(), args.ignoreMissingIncludedModules);
    ServiceLocator.instance.initialize("project", config);
  }
}



export function getProject() {
  return ServiceLocator.instance.get<Project>("project");
}


export function getProjectIfExists() {
  return ServiceLocator.instance.getIfExists<Project>("project");
}
