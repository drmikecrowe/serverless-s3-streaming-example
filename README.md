# serverless-s3-streaming-example
Serverless Project Streaming and Parsing S3 files

## Commands:

* `yarn build:test`:  Build fake CSV data in `fixtures/`
* `yarn deploy`:  Run `serverless deploy` to deploy function to AWS Lambda
* `yarn logs`: Pull the AWS CloudWatch logs for the latest run
* `yarn test`: Run a local test outputing files to `/tmp/output` instead of S3
* `yarn upload:small`: Upload `fixtures/master-data-small.csv` to S3 `${BUCKET}` (set in environment prior to running)
* `yarn upload:medium`: Upload `fixtures/master-data-medium.csv` to S3 `${BUCKET}` (set in environment prior to running)
* `yarn upload:large`: Upload `fixtures/master-data-large.csv` to S3 `${BUCKET}` (set in environment prior to running)

## Validating S3 files

The following commands will downlaod the S3 processed files and use the same validations as `yarn test`:

* **NOTE**: This assumes you've already run `yarn upload:small`

```bash
md /tmp/s3files
aws s3 cp s3://${BUCKET}/dev/processed /tmp/s3files --recursive
ts-node test/fileValidators.ts fixtures/master-data-small.csv /tmp/s3files/
```