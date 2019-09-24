/**
 * Generate data using command: `ts-node fixtures/create-fake-csv.ts`
 *
 * Development:  Debug command: `DEBUG=create-fake-csv ts-node fixtures/create-fake-csv.ts`
 */

import * as fs from "fs";
import * as faker from "faker";
import stringify from 'csv-stringify';
import * as _ from "lodash";
import moment from "moment";

const debug = require("debug")("create-fake-csv");

const FAILURE_RATE = 3; // 3% of the students fail
const CLASSES_PER_DAY = 5; // Students are in 5 classes per day

// Random class names sucked somewhere from the interwebs
const masterClasses = require("./classes.json");
const masterSubjects = _.keys(masterClasses);

/**
 * Sizes interface for generating fake output
 */
interface ISize {
    name: string;
    studentCount: number;
    schoolCount: number;
}

const sizes: ISize[] = [
    { name: "small", studentCount: 15, schoolCount: 3 },
    { name: "medium", studentCount: 22, schoolCount: 10 },
    { name: "large", studentCount: 30, schoolCount: 50 },
];

/**
 * randomElement - Get a random element from an array and optionally remove it
 * @param ary any[] The source array to use for random data
 * @param remove boolean If set, remove the element from the array after returning
 * @param subject string In debug mode, show when removing the element
 */
function randomElement(ary: any[], remove: boolean = false, subject: string = ""): any {
    const elem = ary[_.random(0, ary.length - 1)];
    if (remove) {
        _.pull(ary, elem);
        debug(`Removing item, ${ary.length} ${subject} remaining`);
    }
    return elem;
}

for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];

    // First, build the CSV output stream
    const headers = ["School", "Semester", "Grade", "Subject", "Class", "Student Name", "Score"];
    const csvStream = stringify({
        header: true,
        columns: headers,
    });
    // Create the output stream
    const outStream = fs.createWriteStream(`fixtures/master-data-${size.name}.csv`, { encoding: "utf8" });
    // Pipe the CSV into the output stream
    csvStream.pipe(outStream);

    // Define how big we will make the data
    const MAX_SCHOOLS = size.schoolCount;
    const MAX_STUDENTS_PER_GRADE = size.studentCount;

    // Now, build the data for each school
    for (let i1 = 0; i1 < MAX_SCHOOLS; i1++) {
        const schoolName = `${faker.name.lastName()} High School`;

        // Create a bunch of fake students attending this school
        for (let studentGrade = 9; studentGrade <= 12; studentGrade++) {
            for (let i2 = 0; i2 < MAX_STUDENTS_PER_GRADE; i2++) {
                const studentName = `${faker.name.firstName()} ${faker.name.lastName()}`;

                // Build up the random classes for this school
                const classNames: string[] = [];
                const tmpSubjects = _.clone(masterSubjects); // Get a copy of the subjects so we can allocate a student only once to a class
                debug(`We have ${tmpSubjects.length} subjects to work with`);
                while (classNames.length < CLASSES_PER_DAY) {
                    const classSubject = randomElement(tmpSubjects);
                    const className = randomElement(masterClasses[classSubject]);
                    const description = `${classSubject}/${className}`;
                    if (classNames.indexOf(description) === -1) {
                        classNames.push(description);
                        // Semester is either Spring or Fall of current year
                        const semester = parseInt(moment().format("M")) > 6 ? `Fall-${moment().format("YYYY")}`: `Spring-${moment().format("YYYY")}`;

                        // Assign them a random grade
                        const grade = _.random(0, 100) < FAILURE_RATE ? 0 : _.random(70, 100);

                        // Save it to the CSV file
                        const row = [schoolName, semester, `${studentGrade}th-Grade`, classSubject, className, studentName, grade];
                        csvStream.write(row);
                        debug(row.join(","));
                    }
                }
            }
        }
    }
    csvStream.end();
}
