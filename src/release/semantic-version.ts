import * as standardVersion from "standard-version";
import * as argparse from "argparse";


const parser = new argparse.ArgumentParser();
parser.add_argument("--dir", {
  dest: "dir"
});
parser.add_argument("--prerelease", {
  dest: "prerelease"
});

const args: { dir: string; prerelease?: string } = parser.parse_args();

process.chdir(args.dir);

standardVersion({
  prerelease: args.prerelease,
  skip: {
    changelog: true
  },
  releaseCommitMessageFormat: "automated(version): {{currentTag}}"
}).catch(error => {
  console.log(error);
  process.exit(-1);
});
