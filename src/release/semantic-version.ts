import * as standardVersion from "standard-version";
import * as argparse from "argparse";


const parser = new argparse.ArgumentParser();
parser.addArgument("--dir", {
  dest: "dir"
});

const args: { dir: string } = parser.parseArgs();

process.chdir(args.dir);

standardVersion({
  prerelease: undefined, // todo: control prerelease
  skip: {
    changelog: true
  },
  releaseCommitMessageFormat: "automated(version): {{currentTag}}"
}).catch(error => {
  console.log(error);
  process.exit(-1);
});
