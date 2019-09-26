/**
 * This file provides a test harness for testing locally.
 * It sets up fileHandler with a local stream interface instead of S3
 */
import * as fs from "fs";
import * as path from "path";
import * as mkdirp from "mkdirp";
import rimraf from "rimraf";

import { Readable, Writable, PassThrough } from "stream";
import { FileHandler, IOutputFile } from "../src/lib/FileHandler";
import { compareAllFiles } from "./fileValidators";

const log = require('lambda-log');

const filename = "fixtures/master-data-small.csv";

/**
 * Create the input stream locally
 */
FileHandler.prototype.getReadStream = (srcBucket: string, srcKey: string): Readable => {
    const input = path.join(process.cwd(), srcKey);
    return fs.createReadStream(input, { encoding: "utf8" });
};

/**
 * Create the output stream locally to /tmp/output
 * @param headers: string[] The CSV yeahder
 * @param uniqueIdentifier string The output file path
 */
FileHandler.prototype.getWriteStream = (outputFileName: string, passThruStream: Writable): Promise<any> => {
    // Create a PassThru stream to allow data to flow while deleting
    return new Promise(resolve => {
        // AWS S3.upload pipes stream to bucket file.  Here, we setup a new stream and pipe manually
        const outDir = path.join("/tmp/output", path.dirname(outputFileName));
        const outputPath = path.join("/tmp/output", outputFileName);
        mkdirp.sync(outDir);
    
        const fileStream = fs.createWriteStream(outputPath, { encoding: "utf8" });
        passThruStream.pipe(fileStream);
        // this.parser.on("end", () => passThruStream.end());      // End this passThruStream when the reader completes
        fileStream.on("close", () => {
            log.info(`Output ${outputPath} finished writing`);
            resolve();
        });
    });
};

FileHandler.prototype.deleteOldFiles = (cleanPrefix: string): Promise<any> => {
    // Here we are setting up the promise that will delete the files locally
    return new Promise(resolve => {
        const cleanDir = path.join("/tmp/output", cleanPrefix);
        log.info(`Removing existing files from ${cleanDir}`)
        rimraf(cleanDir, { silent: false }, () => {
            resolve();
        });
    });

}

const fileHandler: FileHandler = new FileHandler("don't care", filename, log);

fileHandler
    .Process()
    .then(() => log.info("Processing Complete!"))
    .then(() => compareAllFiles(filename, "/tmp/output"))
    .catch(err => console.error(err));

process.on("uncaughtException", function(err) {
    log.info(err);
});
