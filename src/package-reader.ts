import * as fs from "fs-extra";
import * as path from "path";
import { ServiceLocator } from "./locator";


export class PackageReader {
  public getPackageMetadataPath(modPath: string): string {
    return path.join(modPath, "package.json");
  }

  public readPackageMetadata(dirPath: string): any | undefined {
    let filePath = this.getPackageMetadataPath(dirPath);

    if (this._metadataCache.has(filePath)) {
      return this._metadataCache.get(filePath)!;
    }

    let metadata: object | undefined;
    try {
      metadata = fs.readJSONSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        metadata = undefined;
      } else {
        throw error;
      }
    }

    if (metadata && typeof metadata !== "object") {
      throw new Error(`Expected contents of ${ filePath } to be object`);
    }

    if (metadata != null) {
      this._metadataCache.set(filePath, metadata);
    }

    return metadata;
  }

  public invalidate(dirPath: string) {
    this._metadataCache.delete(dirPath);
  }

  public static init() {
    ServiceLocator.instance.initialize("packageReader", new PackageReader());
  }

  private _metadataCache = new Map<string, object | undefined>();
}


export function getPackageReader() {
  return ServiceLocator.instance.get<PackageReader>("packageReader");
}
