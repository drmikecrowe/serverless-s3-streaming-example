import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";

import { Readable, Writable } from "stream";
import { IOutputFile } from "../../src/lib/FileHandler";

const debug = require("debug")("s3-stream:StreamUtils:test");

/**
 * Create the input stream locally 
 */
export function getReadStream(srcBucket: string, srcKey: string): Readable {
    const input = path.join(process.cwd(), srcKey);
    return fs.createReadStream(input, { encoding: "utf8" });
}

/**
 * Create the output stream locally to /tmp/output
 * @param headers: string[] The CSV yeahder
 * @param uniqueIdentifier string The output file path
 */
export function getWriteStream(outputStream: Writable, uniqueIdentifier: string): IOutputFile {
    const fs = require("fs");
    const path = require("path");
    const outDir = path.join("/tmp/output", path.dirname(uniqueIdentifier));
    mkdirp.sync(outDir);
    const outputPath = path.join("/tmp/output", uniqueIdentifier);
    const pFinished = new Promise(resolve => {
        // AWS S3.upload pipes stream to bucket file.  Here, we setup a new stream and pipe manually
        const fileStream = fs.createWriteStream(outputPath, { encoding: "utf8" });
        outputStream.pipe(fileStream);
        fileStream.on("close", () => {
            debug(`Output ${outputPath} finished writing`);
            resolve();
        });
    });
    const outputFile: IOutputFile = {
        outputStream: outputStream,
        pFinished
    };
    return outputFile;
}
