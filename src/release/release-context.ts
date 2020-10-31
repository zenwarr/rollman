import * as git from "nodegit";
import { LocalModule } from "../local-module";
import { openRepo } from "./git";


export class ReleaseContext {
  public updated = new Map<LocalModule, { from: string; to: string }>();
  public skipped: LocalModule[] = [];
  private repos = new Map<LocalModule, git.Repository | null>();

  public async getRepo(mod: LocalModule) {
    if (this.repos.has(mod)) {
      return this.repos.get(mod);
    }

    const repo = await openRepo(mod.path);
    this.repos.set(mod, repo);
    return repo;
  }
}


export function cancelRelease() {
  process.exit(1);
}
