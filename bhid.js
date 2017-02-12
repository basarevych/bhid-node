#!/usr/bin/env node

"use strict";

const argv = require('minimist')(process.argv.slice(2));
const path = require('path');
const fs = require('fs');
const Runner = require(path.join(__dirname, 'node_modules', 'arpen', 'src', 'services', 'runner.js'));

let pidPath = path.join('/var', 'run', 'bhid', 'bhid.pid');

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
    let runner = new Runner();
    let proc = runner.spawn(command, params);
    proc.cmd.on('data', data => { process.stdout.write(data); });
    return proc.promise;
}

function execDaemon() {
    return exec(path.join(__dirname, 'bin', 'daemon'), [ pidPath, 'daemon', 'tracker' ]);
}

function execCmd() {
    return exec(path.join(__dirname, 'bin', 'cmd'), process.argv.slice(2));
}

if (!argv['_'].length) {
    usage();
    process.exit(0);
}
if (argv['_'][0] != 'help' && argv['_'][0] != 'install') {
    let etcExists = false;
    for (let dir of [ '/etc/bhid', '/usr/local/etc/bhid' ]) {
        try {
            fs.accessSync(dir, fs.constants.F_OK);
            etcExists = true;
            break;
        } catch (error) {
            // do nothing
        }
    }
    let workExists = true;
    for (let dir of [ '/var/run/bhid', '/var/log/bhid' ]) {
        try {
            fs.accessSync(dir, fs.constants.F_OK);
        } catch (error) {
            workExists = false;
            break;
        }
    }
    if (!etcExists || !workExists) {
        console.log('Run "bhid install" first');
        process.exit(1);
    }
}

switch (argv['_'][0]) {
    case 'help':
        switch (argv['_'][1]) {
            case 'install':
                console.log('Usage: bhid install\n');
                console.log('\tThis command will register the program in the system');
                console.log('\tand will create configuration in /etc/bhid by default')
                break;
            case 'run':
                console.log('Usage: bhid run\n');
                console.log('\tThis command will start the daemon');
                console.log('\tYou might want to run "systemctl bhid start" instead');
                break;
            case 'init':
                console.log('Usage: bhid init <email> <daemon-name> [-t <tracker>]\n');
                console.log('\tInitialize your and daemon accounts on the tracker');
                console.log('\tYou will receive a confirmation email');
                break;
            case 'confirm':
                console.log('Usage: bhid confirm <token> [-t <tracker>]\n');
                console.log('\tConfirm account creation or generation of a new token');
                break;
            case 'create':
                console.log('Usage: bhid create <path> <connect-addr> <listen-addr> [-d <daemon-name>] [-c] [-e] [-t <tracker>]\n');
                console.log(
                    '\tCreate a new connection. If -c is not specified the daemon is configured as server of this\n' +
                    '\tconnection or as client otherwise. If -e is set then connection is encrypted.\n\n' +
                    '\t<connect-addr> and <listen-addr> are written in the form of address:port or just /path/to/unix/socket'
                );
                break;
            default:
                console.log('Usage: bhid help <command>');
                process.exit(1);
        }
        break;
    case 'install':
        execCmd()
            .then(result => {
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'run':
        execDaemon()
            .then(result => {
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'init':
    case 'confirm':
    case 'create':
        execDaemon()
            .then(result => {
                if (result.code !== 0)
                    process.exit(result.code);
                return execCmd();
            })
            .then(result => {
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
