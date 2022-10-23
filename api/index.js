import express from 'express';
import fileUpload from 'express-fileupload';
import serveIndex from 'serve-index';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';

const app = express();
const port = parseInt(process.env.PORT) || 80;

// Use app.locals to store some global state.
app.locals.jobs = new Map();

/**
 * Run `<command> <args>` in a new process.
 * @param {string} command First parameter to child_process.spawn()
 * @param {string[]} args Second parameter to child_process.spawn()
 * @param {number} timeout Number of seconds to wait until declaring job failed.
 * @return {Promise<string>} Promise that resolves with the command output, or rejects with error.
 */
function exec(command, args, { timeout = 60_000 } = {}) {

    // Initiate a promise that resolves or rejects when the process is done.
    const timeoutSeconds = timeout || 60;
    return new Promise((resolve, reject) => {

        // Spawn a new process with the requested command + args.
        const proc = spawn(command, args);

        // When the timeout is reached, assume process is stuck and kill process.
        const timeout = setTimeout(() => {
            try {
                process.kill(-proc.pid, 'SIGKILL');
            } catch (exc) {
                console.error(`Failed to kill process ${-proc.pid} for command:\n${cmd}`);
            } finally {
                reject(new Error(`Process timed out after ${timeoutSeconds} seconds.`));
            }
        }, timeoutSeconds * 1000);

        // Accumulate output in buffer, and print to console for logging purposes.
        const buffer = [];
        proc.on('error', err => console.error(err));
        proc.stdout.on('data', data => {
            const output = data.toString();
            buffer.push(output);
            console.log(output);
        });

        // When the process exits normally, use return code to determine success / failure.
        proc.on('close', code => {
            clearTimeout(timeout);
            if (code === 0) resolve(buffer.join(''));
            else reject(new Error(`Process exited with non-zero code ${code}.`))
        });
    });
}

/**
 * Launch a job running <command> in a new process.
 * @param {string} command First parameter to child_process.spawn()
 * @param {Promise<string>} promise Promise that resolves with a redirect URL.
 * @return {string} Job ID.
 */
function launchJob(promise) {
    // Create an arbitrary pseudo-random job ID.
    const jobId = uuidv4();
    // Initiate a promise that resolves or rejects when the job is done.
    app.locals.jobs.set(jobId, promise);
    // Return the job ID.
    return jobId;
}

app.use(fileUpload());
app.use(express.static('public', { extensions: ['html'] }));

app.post('/api/upload', (req, res) => {
    if (!req.files?.userfile) return res.status(400).send('missing file');
    const fname = req.files.userfile.name;
    req.files.userfile.mv(`public/files/${fname}`);
    res.redirect(`/link?fname=${encodeURIComponent(fname)}`);
});

app.post('/api/ereader', (req, res) => {
    try {
        // Extract form parameters from request body.
        const url = new URL(req.body.url);
        const format = req.body.format;
        const timeout = parseInt(req.body.timeout);

        // Build the command arguments.
        const basename = uuidv4();
        const fname = `${basename}.${format}`;
        const path = `./public/files/${fname}`;
        const args = ['percollate', format, '--output', path, url];

        // Set up redirect URL and launch job.
        const redirect = `/link?fname=${encodeURIComponent(fname)}`;
        const promise = exec('npx', args, { timeout: timeout }).then(() => redirect);
        const jobId = launchJob(promise);

        // Send result as a link instead of redirect to prevent hanging the client.
        return res.send(`Job launched: <a href="/api/job/${jobId}">${jobId}</a>`);
        // return res.redirect(`/api/job/${jobId}`);

    } catch (exc) {
        return res.status(500).send({ id: null, status: 'error', error: exc.message });
    }
});

app.get('/api/job/:id', async (req, res) => {
    const jobId = req.params.id;
    const promise = app.locals.jobs.get(jobId);
    try {
        const redirect = await promise;
        if (redirect) return res.redirect(redirect);
        else return res.send({ id: jobId, status: 'finished' });
    } catch (exc) {
        return res.status(500).send({ id: jobId, status: 'error', error: exc.message });
    }
});

// Serve the contents under /files.
app.use('/files', serveIndex('public/files', { 'icons': true }));
app.use('/files', express.static('public/files'));

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});