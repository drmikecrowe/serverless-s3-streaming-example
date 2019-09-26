import { Readable, Writable, PassThrough } from "stream";
import { Parser } from "csv-parse";
import stringify from "csv-stringify";
import * as assert from "assert";
import { LambdaLog } from "lambda-log";
import * as _ from "lodash";

import { S3 } from "aws-sdk";
const s3 = new S3();

export interface IOutputFile {
    passThruStream: Writable;
    pFinished: Promise<any>;
}

export class FileHandler {
    // S3 Source Details
    srcBucket: string;
    srcKey: string;
    destBucket: string;
    destPrefix: string;

    // Streams
    private readStream: Readable;

    // Tracker for output groups and streams
    private deletePromises: Record<string, Promise<any>>;
    private outputStreams: Record<string, IOutputFile>;

    // Progress Promises
    private pAllRecordsRead: Promise<any>;

    // CSV Handlers
    private parser: Parser;

    // Logger
    private log: LambdaLog;

    constructor(srcBucket: string, srcKey: string, log: LambdaLog) {
        assert.ok(process.env.DEST_BUCKET, `DEST_BUCKET not in the environment`);
        assert.ok(process.env.DEST_PREFIX, `DEST_PREFIX not in the environment`);
        this.srcBucket = srcBucket;
        this.srcKey = srcKey;
        this.destBucket = process.env.DEST_BUCKET as string;
        this.destPrefix = process.env.DEST_PREFIX as string;
        this.log = log;
        this.deletePromises = {};
        this.outputStreams = {};
        log.debug(`FileHandler configured`);
    }

    private rethrowError(where: string, err: any) {
        this.log.error(`Function: ${where}: `, err);
        throw err;
    }

    /**
     * Fires when entire process has completed for the file
     */
    async Process(): Promise<any> {
        this.log.debug(`Starting to process`);
        this.openReadStream();
        this.log.info(`Starting waiting for promises to finish`);
        // Wait for the CSV parse to be complete before building list of all promises to resolve
        await this.pAllRecordsRead;
        this.log.info(`Streaming complete, waiting on uploads to finish`);
        const promises: Promise<any>[] = [];
        for (let group of Object.keys(this.outputStreams)) {
            promises.push(this.outputStreams[group].pFinished);
        }
        await Promise.all(promises);
        this.log.info(`All Promises Complete`);
    }

    /**
     * Open the S3 object for streaming and pipes to CSV parser.
     * Resolves when CSV parser completes processing
     */
    openReadStream() {
        this.parser = new Parser({
            delimiter: ",",
            columns: true,
            skip_empty_lines: true,
            bom: true,
        });
        this.readStream = this.getReadStream(this.srcBucket, this.srcKey);
        this.pAllRecordsRead = new Promise((resolve, reject) => {
            this.readStream.on("error", err => reject(err));
            this.parser.on("error", err => reject(err));
            this.parser.on("readable", () => this.newLineAvailable());
            this.parser.on("end", () => {
                Object.keys(this.outputStreams).map(outputFile => this.outputStreams[outputFile].passThruStream.end());
                resolve();
            });
            this.readStream.pipe(this.parser);
        });
    }

    /**
     * Create the input stream from S3
     */
    getReadStream(srcBucket: string, srcKey: string): Readable {
        const params: S3.GetObjectRequest = { Bucket: srcBucket, Key: srcKey };
        return s3.getObject(params).createReadStream();
    }

    /**
     * getWriteStream pipes a stream to S3
     * @param outputFileName string The output key/filename to write in S3
     * @param passThruStream Writable The source stream for the output file
     */
    getWriteStream(outputFileName: string, passThruStream: Writable): Promise<any> {
        return new Promise((resolve, reject) => {
            const outputPath = `${this.destPrefix}/${outputFileName}`;
            this.log.debug(`Copying ${this.destBucket}/${outputPath}`);
            const params: S3.PutObjectRequest = { Bucket: this.destBucket, Key: outputPath, Body: passThruStream };
            s3.upload(params)
                .promise()
                .then(() => resolve())
                .catch(err => this.rethrowError(`getWriteStream/s3`, err));
        });
    }

    /**
     *
     * @param cleanPrefix string The prefix to delete
     */

    async deleteOldFiles(cleanPrefix: string): Promise<any> {
        const destBucket = process.env.DEST_BUCKET as string;
        const destPrefix = process.env.DEST_PREFIX as string;
        const outputPath = `${destPrefix}/${cleanPrefix}/`;
        this.log.info(`Removing s3://${destBucket}/${outputPath}`);

        let params: S3.ListObjectsV2Request = {
            Bucket: destBucket,
            Prefix: outputPath,
        };

        let currentData: S3.ListObjectsV2Output;

        try {
            currentData = await s3.listObjects(params).promise();
        } catch (err) {
            this.log.info(`No objects found to delete`);
            return;
        }

        if (!currentData.Contents || currentData.Contents.length === 0) return;

        const deleteParams: S3.DeleteObjectsRequest = {
            Bucket: destBucket,
            Delete: { Objects: [] },
        };

        currentData.Contents.forEach(content => {
            if (content.Key) {
                this.log.debug(`Removing ${content.Key}`);
                deleteParams.Delete.Objects.push({ Key: content.Key });
            }
        });

        const res: S3.DeleteObjectsOutput = await s3.deleteObjects(deleteParams).promise();

        this.log.info(`Removed ${(currentData.Contents as any).length}, result: `, res);
        if (currentData.IsTruncated) {
            await this.deleteOldFiles(cleanPrefix);
        }
        return true;
    }

    /**
     * Fires when CSV parser has readable data.
     * Processes all data while available
     */
    newLineAvailable() {
        let record;
        while ((record = this.parser.read())) {
            const headers = Object.keys(record);
            if (!record || headers.length === 0) continue;

            // This is very demo-specific.  It separates our sample data into separate files by class
            const outputFileName = `${record["Semester"]}/${record["School"]}/${record["Grade"]}/${record["Subject"]}-${record["Class"]}.csv`;

            if (!this.outputStreams[outputFileName]) {
                // Here, we're defining the prefix that new files replace.  In this demo, I'm basically saying that any file with
                // Fall-2019 records are replacing that entire directory.  This is application specific -- other conditions may just replace the School,
                // or the Grade
                const topLevelFolder = `${record["Semester"]}`;
                if (!this.deletePromises[topLevelFolder]) {
                    this.deletePromises[topLevelFolder] = this.deleteOldFiles(topLevelFolder);
                }

                const passThruStream = stringify({
                    header: true,
                    columns: headers,
                });

                const pFinished = new Promise(resolve => {
                    this.deletePromises[topLevelFolder]
                        .then(() => this.getWriteStream(outputFileName, passThruStream))
                        .catch(err => this.rethrowError(`newLineAvailable/pFinished`, err));
                });

                const outputFile: IOutputFile = {
                    passThruStream,
                    pFinished,
                };
                this.outputStreams[outputFileName] = outputFile;
            }
            this.outputStreams[outputFileName].passThruStream.write(record);
        }
    }
}
