import * as standardVersion from "standard-version";
import * as argparse from "argparse";


const parser = new argparse.ArgumentParser();
parser.addArgument("--dir", {
  dest: "dir"
});
parser.addArgument("--prerelease", {
  dest: "prerelease"
});

const args: { dir: string; prerelease?: string } = parser.parseArgs();

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
