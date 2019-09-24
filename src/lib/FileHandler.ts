import { Readable, Writable } from "stream";
import { Parser } from "csv-parse";
import stringify from "csv-stringify";

const debug = require("debug")("s3-stream:FileHandler");

export interface IFileHandler {
    s3Bucket: string;
    s3Key: string;
    getReadStream(srcBucket: string, srcKey: string): Readable;
    getWriteStream(outputStream: Writable, uniqueIdentifier: string): IOutputFile;
}

export interface IOutputFile {
    outputStream: Writable;
    pFinished: Promise<any>;
    monitored?: boolean;
}

export class FileHandler {
    // Streams
    private readStream: Readable;

    // Tracker for unique outputs
    private groups: Record<string, IOutputFile>;

    // Progress Promises
    private pAllRecordsRead: Promise<any>;

    // CSV Handlers
    private parser: Parser;

    // Local config
    private setup: IFileHandler;

    constructor(setup: IFileHandler) {
        this.setup = setup;
        this.groups = {};
        debug(`FileHandler configured`);
    }

    /**
     * Fires when entire process has completed for the file
     */
    Process(): Promise<any> {
        debug(`Starting to process`);
        return this.openReadStream()
            .then(() => Promise.resolve(debug(`Starting waiting for promises to finish`)))
            .then(() => this.waitForAll())
            .then(() => Promise.resolve(debug(`All Promises Complete`)));
    }

    /**
     * Open the S3 object for streaming and pipes to CSV parser.
     * Resolves when CSV parser completes processing
     */
    private async openReadStream(): Promise<any> {
        this.parser = new Parser({
            delimiter: ",",
            columns: true,
            skip_empty_lines: true,
            bom: true,
        });
        this.readStream = await this.setup.getReadStream(this.setup.s3Bucket, this.setup.s3Key);
        this.pAllRecordsRead = new Promise((resolve, reject) => {
            this.readStream.on("error", err => {
                console.error(`openReadStream Error: `, err);
                reject(err);
            });
            this.parser.on("error", err => {
                console.error(`openReadStream Error: `, err);
                reject(err);
            });
            this.parser.on("readable", () => this.newLineAvailable());
            this.parser.on("end", () => {
                for (let group of Object.keys(this.groups)) {
                    this.groups[group].outputStream.end();
                }
                resolve();
            });
            this.readStream.pipe(this.parser);
        });
    }

    /**
     * Fires when CSV parser has readable data.
     * Processes all data while available
     */
    private newLineAvailable() {
        let record;
        while ((record = this.parser.read())) {
            const headers = Object.keys(record);
            if (!record || headers.length === 0) continue;

            // This is very demo-specific.  It separates our sample data into separate files by class
            const uniqueIdentifier = `${record["School"]}/${record["Semester"]}/${record["Grade"]}/${record["Subject"]}-${record["Class"]}.csv`;

            if (!this.groups[uniqueIdentifier]) {
                const csvStream = stringify({
                    header: true,
                    columns: headers,
                });
                this.groups[uniqueIdentifier] = this.setup.getWriteStream(csvStream, uniqueIdentifier);
            }
            this.groups[uniqueIdentifier].outputStream.write(record);
        }
    }

    /**
     * Wait for all promises to finish
     */
    private waitForAll(): Promise<any> {
        // Wait for the CSV parse to be complete before building list of all promises to resolve
        return this.pAllRecordsRead.then(() => {
            debug(`Streaming complete, waiting on uploads to finish`);
            const promises: Promise<any>[] = [];
            for (let group of Object.keys(this.groups)) {
                promises.push(this.groups[group].pFinished);
                this.groups[group].monitored = true;
            }
            return Promise.all(promises);
        });
    }
}
