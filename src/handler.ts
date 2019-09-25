import { S3CreateEvent, S3EventRecord } from "aws-lambda";
import "source-map-support/register";
import dalamb from "dalamb";
import { FileHandler } from "../src/lib/FileHandler";

const log = require("lambda-log");

export default dalamb<S3CreateEvent>(async event => {
    // set some optional metadata to be included in all logs (this is an overkill example)
    log.options.meta.event = event;
    log.options.debug = (process.env.STAGE === "dev");
    // add additional tags to all logs
    log.options.tags.push(...[process.env.STAGE, event.Records[0].s3.bucket]);
    const promises: Promise<void>[] = [];
    event.Records.forEach((record: S3EventRecord) => {
        const bucket = record.s3.bucket.name;
        const filename = record.s3.object.key;
        const filesize = record.s3.object.size;
        log.info(`New file has been uploaded: ${filename} (${filesize} bytes)`);
        const fileHandler: FileHandler = new FileHandler(bucket, filename, log);
        promises.push(fileHandler.Process());
    });
    await Promise.all(promises);
    log.info(`Processed ${promises.length} files`);
});
