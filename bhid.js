#!/usr/bin/env node

"use strict";

const argv = require('minimist')(process.argv.slice(2));
const execFile = require('child_process').execFile;
const path = require('path');

function usage() {
    console.log('Usage: bhid <command>');
    console.log('Commands:');
    console.log('\thelp\t\tPrint help about any other command');
    console.log('\tinstall\t\tRegister the program in the system');
    console.log('\tinit\t\tInitialize the account');
    console.log('\tconfirm\t\tConfirm email');
    console.log('\tcreate\t\tCreate new connection');
    console.log('\trun\t\tRun the program');
}

function exec(command, params = []) {
    let env = {
        "LANGUAGE": "C.UTF-8",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin",
        "DEBUG": "bhid:*",
    };

    return new Promise((resolve, reject) => {
        execFile(command, params, {env}, (error, stdout, stderr) => {
            if (error) {
                if (typeof error.code == 'number' || error.signal) {
                    return resolve({
                        code: error.code,
                        signal: error.signal,
                        stdout: stdout,
                        stderr: stderr,
                    });
                }
                return reject(error);
            }

            resolve({
                code: 0,
                signal: null,
                stdout: stdout,
                stderr: stderr,
            });
        });
    });
}

let pidPath = path.join('/var', 'run', 'bhid.pid');
switch (argv['_'][0]) {
    case 'help':
        switch (argv['_'][1]) {
            case 'install':
                console.log('Usage: bhid install');
                console.log('\tThis command will register the program in the system');
                console.log('\tand will create configuration in /etc/bhid by default')
                break;
            case 'run':
                console.log('Usage: bhid run');
                console.log('\tThis command will start the daemon');
                console.log('\tYou might want to run "systemctl bhid start" instead');
                break;
            case 'init':
                console.log('Usage: bhid init <email> <name> [-t <tracker>]');
                console.log('\tInitialize your and daemon accounts on the tracker');
                console.log('\tYou will receive a confirmation email');
                break;
            case 'confirm':
                console.log('Usage: bhid confirm <token> [-t <tracker>]');
                console.log('\tConfirm account creation or generation of a new token');
                break;
            case 'create':
                console.log('Usage: bhid create <path> <server-addr>:<server-port> <- <client-addr>:<client-port> [-t <tracker>]');
                console.log('       bhid create <path> <client-addr>:<client-port> -> <server-addr>:<server-port> [-t <tracker>]');
                console.log('\tCreate a new connection. First form will register this daemon as server, second as client of this' +
                            'connection');
                break;
            default:
                console.log('Usage: bhid help <command>');
                process.exit(1);
        }
        break;
    case 'install':
        exec(path.join(__dirname, 'bin', 'cmd'), process.argv.slice(2))
            .then(result => {
                if (result.stdout.length)
                    console.log(result.stdout.trim());
                if (result.stderr.length)
                    console.error(result.stderr.trim());
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'run':
        exec(path.join(__dirname, 'bin', 'server'), [ 'tracker', '-d', pidPath ])
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'init':
    case 'confirm':
    case 'create':
        exec(path.join(__dirname, 'bin', 'server'), [ 'tracker', '-d', pidPath ])
            .then(() => {
                return exec(path.join(__dirname, 'bin', 'cmd'), process.argv.slice(2));
            })
            .then(result => {
                if (result.stdout.length)
                    console.log(result.stdout.trim());
                if (result.stderr.length)
                    console.error(result.stderr.trim());
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    default:
        usage();
        process.exit(1);
}
