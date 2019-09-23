import { S3CreateEvent } from "aws-lambda";
import "source-map-support/register";
import dalamb from "dalamb";

export default dalamb<S3CreateEvent>(async event => {
    event.Records.forEach(record => {
        const filename = record.s3.object.key;
        const filesize = record.s3.object.size;
        console.log(`New file has been uploaded: ${filename} (${filesize} bytes)`);
        console.log(JSON.stringify(event, null, 4));
    });
});
