import { Readable, Writable } from "stream";
import { S3 } from "aws-sdk";
import { IOutputFile } from "./FileHandler";
import * as assert from "assert";

const debug = require("debug")("s3-stream:StreamUtils:live");

const s3 = new S3();

/**
 * Create the input stream from S3 
 */
export function getReadStream(srcBucket: string, srcKey: string): Readable {
    const params: S3.GetObjectRequest = { Bucket: srcBucket, Key: srcKey };
    return s3.getObject(params).createReadStream();
}

/**
 * Create the output stream in S3 
 * @param headers: string[] The CSV yeahder
 * @param uniqueIdentifier string The output file path
 */
export function getWriteStream(outputStream: Writable, uniqueIdentifier: string): IOutputFile {
    assert.ok(process.env.DEST_BUCKET, `DEST_BUCKET not in the environment`);
    assert.ok(process.env.DEST_PREFIX, `DEST_PREFIX not in the environment`);
    const destBucket = process.env.DEST_BUCKET as string;
    const destPrefix = process.env.DEST_PREFIX as string;
    const outputPath = `${destPrefix}/${uniqueIdentifier}`;
    const params: S3.PutObjectRequest = { Bucket: destBucket, Key: outputPath, Body: outputStream };
    const pFinished = new Promise(resolve => {
        s3.upload(params).promise().then(() => {
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
