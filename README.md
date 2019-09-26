# Serverless Project Streaming and Parsing S3 files

This repo illustrates how to stream a large file from S3 and split it into separate S3 files after removing prior files

## Goals

1.  Parse a large file without loading the whole file into memory
2.  Remove old data when new data arrives
3.  Wait for all these secondary streams to finish uploading to s3

## Managing Complex Timing 

* Writing to S3 is slow.  You must ensure you wait until the S3 upload is complete
* We can't start writing to S3 **until** all the old files are deleted.
* We don't know how many output files will be created, so we must wait until the input file has finished processing before starting to waiting for the outputs to finish

## Demo Repository

To [simulate this scenario](https://github.com/drmikecrowe/serverless-s3-streaming-example), I contrived the following:

* A school district central computer uploads all the grades for the district for a semester
* The data file is has the following headers: 
    * `School,Semester,Grade,Subject,Class,Student Name,Score`
* Process the uploaded file, splitting it into the following structure:
    * Semester/School/Grade
    * Create a file called Subject-Class.csv with all the grades for that class
* For this simulation, the central computer can update an entire Semester by uploading a new file.  This could be set differently based on the application:  For instance, if the central computer could upload the grades for a specific Semester + School, then we could update [this line](https://github.com/drmikecrowe/serverless-s3-streaming-example/blob/master/src/lib/FileHandler.ts#L189) with the revised criteria to only clear that block of data

Here's the general outline of the demo program flow:

* Open the S3 file as a Stream (`readStream`)
* Create a `csvStream` from the input `readStream`
* Pipe `readStream` to `csvStream`
* While we have New Lines
    * Is this line for a new school (i.e. new CSV file)?
        * Start a PassThru stream (`passThruStream`)
        * Does this line start a new Semester (top-level folder we're replacing) in S3?
            * Start deleting S3 folder
        * Are all files deleted?
            * Use `s3.upload` with `Body`=`passThruStream` to upload the file
    * Write New Line to the `passThruStream`
* Loop thru all `passThruStream` streams and close/end
* Wait for all `passThruStream` streams to finish writing to S3

## Environment Variables

```
BUCKET=(your s3 bucket name)
```

## yarn Commands:

* `yarn build:test`:  Build fake CSV data in `fixtures/`
* `yarn test`: Run a local test outputing files to `/tmp/output` instead of S3
* `yarn deploy:dev`:  Run `serverless deploy` with (stage=dev) to deploy function to AWS Lambda
* `yarn deploy:prod`:  Run `serverless deploy --stage prod` to deploy function to AWS Lambda
* `yarn logs:dev`: Pull the AWS CloudWatch logs for the latest stage=dev run
* `yarn logs:prod`: Pull the AWS CloudWatch logs for the latest stage=prod run
* `yarn upload:small:tiny`: Upload `fixtures/master-data-tiny.csv` to S3 `${BUCKET}/dev/uploads` 
* `yarn upload:small:dev`: Upload `fixtures/master-data-small.csv` to S3 `${BUCKET}/dev/uploads` 
* `yarn upload:medium:dev`: Upload `fixtures/master-data-medium.csv` to S3 `${BUCKET}/dev/uploads` 
* `yarn upload:large:dev`: Upload `fixtures/master-data-large.csv` to S3 `${BUCKET}/dev/uploads` 
* `yarn upload:small:tiny`: Upload `fixtures/master-data-tiny.csv` to S3 `${BUCKET}/prod/uploads` 
* `yarn upload:small:prod`: Upload `fixtures/master-data-small.csv` to S3 `${BUCKET}/prod/uploads` 
* `yarn upload:medium:prod`: Upload `fixtures/master-data-medium.csv` to S3 `${BUCKET}/prod/uploads` 
* `yarn upload:large:prod`: Upload `fixtures/master-data-large.csv` to S3 `${BUCKET}/prod/uploads` 

## Validating S3 files

The following commands will downlaod the S3 processed files and use the same validations as `yarn test`:

* **NOTE**: This assumes you've already run `yarn upload:small`

```bash
md /tmp/s3files
aws s3 cp s3://${BUCKET}/dev/processed /tmp/s3files --recursive
ts-node test/fileValidators.ts fixtures/master-data-small.csv /tmp/s3files/
```