import { S3CreateEvent, S3EventRecord } from "aws-lambda";
import "source-map-support/register";
import dalamb from "dalamb";
import { FileHandler, IFileHandler, IOutputFile } from "../src/lib/FileHandler";
import { getReadStream, getWriteStream } from './lib/StreamUtils.live';

export default dalamb<S3CreateEvent>(async event => {
    const promises: Promise<void>[] = [];
    event.Records.forEach((record: S3EventRecord) => {
        const filename = record.s3.object.key;
        const filesize = record.s3.object.size;
        console.log(`New file has been uploaded: ${filename} (${filesize} bytes)`);
        const fileHandlerSetup: IFileHandler = {
            s3Bucket: record.s3.bucket.name,
            s3Key: filename,
            getReadStream,
            getWriteStream,
        };
        const fileHandler: FileHandler = new FileHandler(fileHandlerSetup);
        promises.push(fileHandler.Process());
    });
    return Promise.all(promises);
});
