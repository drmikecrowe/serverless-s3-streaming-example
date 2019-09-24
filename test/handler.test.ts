/**
 * This file provides a test harness for testing locally.  
 * It sets up fileHandler with a local stream interface instead of S3
 */

import { FileHandler, IFileHandler } from "../src/lib/FileHandler";
import { getReadStream, getWriteStream } from "./lib/StreamUtils.local";

const debug = require("debug")("FileHandler:test");

const filename = "fixtures/master-data-small.csv";

const fileHandlerSetup: IFileHandler = {
    s3Bucket: "dont care",
    s3Key: filename,
    getReadStream,
    getWriteStream,
};

const fileHandler: FileHandler = new FileHandler(fileHandlerSetup);

fileHandler
    .Process()
    .then(() => debug("Processing Complete!"))
    .catch(err => console.error(err));

process.on("uncaughtException", function(err) {
    console.log(err);
});
