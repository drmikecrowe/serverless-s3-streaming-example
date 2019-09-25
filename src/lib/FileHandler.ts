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
        this.srcBucket = srcBucket;
        this.srcKey = srcKey;
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
    Process(): Promise<any> {
        return Promise.resolve(this.log.debug(`Starting to process`))
            .then(() => Promise.resolve(this.openReadStream()))
            .then(() => Promise.resolve(this.log.info(`Starting waiting for promises to finish`)))
            .then(() => this.waitForAll())
            .then(() => Promise.resolve(this.log.info(`All Promises Complete`)))
            .catch(err => this.rethrowError("Process", err));
    }

    /**
     * Wait for all promises to finish
     */
    waitForAll(): Promise<any> {
        // Wait for the CSV parse to be complete before building list of all promises to resolve
        return this.pAllRecordsRead
            .then(() => {
                this.log.info(`Streaming complete, waiting on uploads to finish`);
                const promises: Promise<any>[] = [];
                for (let group of Object.keys(this.outputStreams)) {
                    promises.push(this.outputStreams[group].pFinished);
                }
                return Promise.all(promises);
            })
            .catch(err => this.rethrowError(`getWriteStream`, err));
    }

    /**
     * Create the input stream from S3
     */
    getReadStream(srcBucket: string, srcKey: string): Readable {
        const params: S3.GetObjectRequest = { Bucket: srcBucket, Key: srcKey };
        return s3.getObject(params).createReadStream();
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
     * Create the output stream in S3
     * @param headers: string[] The CSV yeahder
     * @param uniqueIdentifier string The output file path
     */
    getWriteStream(passThruStream: Writable, uniqueIdentifier: string, pDeleted: Promise<any>): IOutputFile {
        // This promise both waits on delete to finish, then starts the output stream

        assert.ok(process.env.DEST_BUCKET, `DEST_BUCKET not in the environment`);
        assert.ok(process.env.DEST_PREFIX, `DEST_PREFIX not in the environment`);
        const pFinished = new Promise(resolve => {
            pDeleted
                .then(() => {
                    const destBucket = process.env.DEST_BUCKET as string;
                    const destPrefix = process.env.DEST_PREFIX as string;
                    const outputPath = `${destPrefix}/${uniqueIdentifier}`;
                    this.log.debug(`Copying ${destBucket}/${outputPath}`);
                    const params: S3.PutObjectRequest = { Bucket: destBucket, Key: outputPath, Body: passThruStream };
                    s3.upload(params)
                        .promise()
                        .then(() => {
                            resolve();
                        })
                        .catch(err => this.rethrowError(`getWriteStream/s3`, err));
                })
                .catch(err => this.rethrowError(`getWriteStream/pDeleted`, err));
        });

        const outputFile: IOutputFile = {
            passThruStream,
            pFinished,
        };
        return outputFile;
    }

    /**
     *
     * @param prefix string The prefix to delete
     */

    deleteOldFiles(prefix: string): Promise<any> {
        const destBucket = process.env.DEST_BUCKET as string;
        const destPrefix = process.env.DEST_PREFIX as string;
        const outputPath = `${destPrefix}/${prefix}/`;
        this.log.info(`Removing s3://${destBucket}/${outputPath}`);

        let currentData: S3.ListObjectsV2Output;
        let params: S3.ListObjectsV2Request = {
            Bucket: destBucket,
            Prefix: outputPath,
        };

        return s3
            .listObjects(params)
            .promise()
            .then((data: S3.ListObjectsV2Output) => {
                currentData = data;
                if (!currentData.Contents || currentData.Contents.length === 0) throw new Error("List of objects empty.");

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

                return s3.deleteObjects(deleteParams).promise();
            })
            .then((res: S3.DeleteObjectsOutput) => {
                this.log.info(`Removed ${(currentData.Contents as any).length}, result: `, res);
                if (currentData.IsTruncated) {
                    return this.deleteOldFiles(prefix);
                }
                return true;
            })
            .catch(err => {
                this.log.error(err);
                return Promise.resolve();       // Don't let this be a fatal error
            });
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
            const uniqueIdentifier = `${record["Semester"]}/${record["School"]}/${record["Grade"]}/${record["Subject"]}-${record["Class"]}.csv`;

            if (!this.outputStreams[uniqueIdentifier]) {
                // Here, we're defining the prefix that new files replace.  In this demo, I'm basically saying that any file with
                // Fall-2019 records are replacing that entire directory.  This is application specific -- other conditions may just replace the School,
                // or the Grade
                const selector = `${record["Semester"]}`;
                if (!this.deletePromises[selector]) {
                    this.deletePromises[selector] = this.deleteOldFiles(selector);
                }

                const csvStream = stringify({
                    header: true,
                    columns: headers,
                });
                this.outputStreams[uniqueIdentifier] = this.getWriteStream(csvStream, uniqueIdentifier, this.deletePromises[selector]);
            }
            this.outputStreams[uniqueIdentifier].passThruStream.write(record);
        }
    }
}
