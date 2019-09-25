/**
 * This file provides comparison functions for raw files
 */

import * as fs from "fs";
import globby from "globby";
import * as assert from "assert";

export const readSrcLines = async (src: string) => {
    const res: any = {};
    const lines = fs.readFileSync(src, "utf8").split("\n");
    lines.shift(); // drop header
    while (lines.length) {
        const line: string = lines.shift() as string;
        if (line > "") {
            res[line] = false;
        }
    }
    return res;
};

export const compareAllFiles = async (filename: string, dirname: string) => {
    const srcLines: any = await readSrcLines(filename);
    const opts: globby.GlobbyOptions = {
        deep: 10,
    };
    const errors: any = {
        duplicates: 0,
        new_lines: 0,
        missing_lines: 0,
        same_lines: 0
    };
    const outputFiles: string[] = await globby(dirname, opts);
    while (outputFiles.length) {
        const fname = outputFiles.shift() as string;
        const lines = fs.readFileSync(fname, "utf8").split("\n");
        lines.shift(); // discard header
        while (lines.length) {
            const line = lines.shift() as string;
            if (line > "") {
                if (srcLines[line]) {
                    console.error(`DUPLICATE LINE: ${line}`);
                    errors.duplicates++;
                } else if (srcLines[line] !== false) {
                    console.error(`NEW LINE: ${line}`);
                    errors.new_lines++;
                } else {
                    srcLines[line] = true;
                    errors.same_lines++;
                }
            }
        }
    }
    for (let line in srcLines) {
        if (!srcLines[line]) {
            console.error(`MISSING LINE: ${line}`);
            errors.missing_lines++;
        }
    }
    console.log(errors);
};

if (require.main === module) {
    const srcFile: string = process.argv[2];
    const destDir: string = process.argv[3];
    assert.ok(srcFile, `First parameter must be the csv file`);
    assert.ok(destDir, `Second parameter must be the directory of the downloaded files`);
    compareAllFiles(srcFile, destDir)
        .then(() => console.log("Done!"))
        .catch(err => console.error(err));
}
