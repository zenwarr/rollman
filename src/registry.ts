import { getCommandOutput, getNpmExecutable } from "./process";
import { getProject } from "./project";


export interface PublishedPackageInfo {
  versions: string[];
  integrity?: string;
  tarball?: string;
  manifest: any;
}


export async function getPublishedPackageInfo(packageName: string): Promise<PublishedPackageInfo | undefined> {
  const project = getProject();

  let output = await getCommandOutput(getNpmExecutable(), [ "view", "--json", packageName ], {
    silent: true,
    cwd: project.rootDir,
    ignoreExitCode: true
  });
  if (!output) {
    return undefined;
  }

  let parsedOutput = JSON.parse(output);
  if (parsedOutput.error && parsedOutput.error.code === "E404") {
    return undefined;
  } else if (parsedOutput.error) {
    throw new Error(`Failed to get package info (${ packageName }): ${ parsedOutput.error?.code } ${ parsedOutput.error?.summary }`);
  }

  return {
    versions: parsedOutput.versions,
    integrity: parsedOutput.dist?.integrity,
    tarball: parsedOutput.dist?.tarball,
    manifest: parsedOutput
  };
}


export async function isVersionPublished(packageName: string, version: string): Promise<boolean> {
  const info = await getPublishedPackageInfo(packageName);
  return !!info && info.versions.includes(version);
}
