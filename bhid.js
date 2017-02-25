#!/usr/bin/env node

"use strict";

const argv = require('minimist')(process.argv.slice(2));
const path = require('path');
const fs = require('fs');
const execFile = require('child_process').execFile;
const Runner = require(path.join(__dirname, 'node_modules', 'arpen', 'src', 'services', 'runner.js'));

let pidPath = path.join('/var', 'run', 'bhid', 'bhid.pid');

function usage() {
    console.log('Usage: bhid <command>');
    console.log('Commands:');
    console.log('\thelp\t\tPrint help about any other command');
    console.log('\tinstall\t\tRegister the program in the system');
    console.log('\tinit\t\tInitialize the account');
    console.log('\tconfirm\t\tConfirm email');
    console.log('\tregister\t\tRegister new daemon');
    console.log('\tauth\t\tSet and save token for the daemon');
    console.log('\tcreate\t\tCreate new connection');
    console.log('\tdelete\t\tDelete a connection');
    console.log('\tconnect\t\tMake the daemon server or client of a connection');
    console.log('\tdisconnect\tDisconnect the daemon from given path');
    console.log('\ttree\t\tPrint user tree');
    console.log('\tload\t\tLoad current connection configuration from tracker');
    console.log('\tredeem\t\tRedeem account, daemon or connection token');
    console.log('\tstart\t\tStart the daemon');
    console.log('\tstop\t\tStop the daemon');
}

function execDaemon() {
    let runner = new Runner();
    let proc = runner.spawn(path.join(__dirname, 'bin', 'daemon'), [ pidPath, 'daemon', 'tracker', 'peer', 'front' ]);
    proc.cmd.on('data', data => { process.stdout.write(data); });
    return proc.promise;
}

function execCommand(command, params) {
    return new Promise((resolve, reject) => {
        try {
            let proc = execFile(
                path.join(__dirname, 'bin', command),
                params,
                (error, stdout, stderr) => {
                    resolve({
                        code: error ? error.code : 0,
                        stdout: stdout,
                        stderr: stderr,
                    });
                }
            );
            proc.stdout.pipe(process.stdout);
            proc.stderr.pipe(process.stderr);
            process.stdin.pipe(proc.stdin);
        } catch (error) {
            reject(error);
        }
    });
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
                console.log('\tand will create configuration in /etc/bhid by default');
                break;
            case 'init':
                console.log('Usage: bhid init <email> [-t <tracker>]\n');
                console.log('\tInitialize your account on the tracker');
                console.log('\tYou will receive a confirmation email');
                break;
            case 'confirm':
                console.log('Usage: bhid confirm <token> [-t <tracker>]\n');
                console.log('\tConfirm account creation');
                break;
            case 'register':
                console.log('Usage: bhid register <master-token> [<daemon-name>] [-r] [-t <tracker>]\n');
                console.log('\tCreate new daemon. If name and -r flag are set then the name will be randomized');
                break;
            case 'auth':
                console.log('Usage: bhid auth <token> [-t <tracker>]\n');
                console.log('\tSet and save the token of this daemon');
                break;
            case 'create':
                console.log('Usage: bhid create <path> <connect-addr> <listen-addr>');
                console.log('                   [-d <daemon-name>] [-s|-c] [-e] [-f] [-t <tracker>]\n');
                console.log(
                    '\tCreate a new connection. If -s is set then the daemon is configured as server of this connection,\n' +
                    '\tor as client when -c is set. If -e is set then connection is encrypted. If -f is set then\n' +
                    '\tconnection is fixed (clients list is saved and unknown clients will not be accepted until next\n' +
                    '\t"load" command run).\n\n' +
                    '\t<connect-addr> and <listen-addr> are written in the form of address:port or just /path/to/unix/socket'
                );
                break;
            case 'delete':
                console.log('Usage: bhid delete <path> [-t <tracker>]\n');
                console.log('\tDelete path recursively with all the connections');
                break;
            case 'connect':
                console.log('Usage: bhid connect <token> [-d <daemon-name>] [-t <tracker>]\n');
                console.log('\tConnect the daemon to the network with the help of the token');
                break;
            case 'disconnect':
                console.log('Usage: bhid disconnect <path> [-d <daemon-name>] [-t <tracker>]\n');
                console.log('\tDisconnect the daemon without deleting the connection information and affecting other daemons');
                break;
            case 'tree':
                console.log('Usage: bhid tree [<path>] [-d <daemon-name>] [-t <tracker>]\n');
                console.log('\tPrint connections of this account');
                break;
            case 'load':
                console.log('Usage: bhid load [-q] [-t <tracker>]\n');
                console.log('\tRetrieve and save locally connection configuration. If -q is set no confirmation is asked');
                break;
            case 'redeem':
                console.log('Usage: bhid redeem <email> [-t <tracker>]');
                console.log('       bhid redeem <master-token> <daemon-name> [-t <tracker>]');
                console.log('       bhid redeem <master-token> <path> [-s|-c] [-t <tracker>]\n');
                console.log('\tRedeem account, daemon or connection token. If -c is set the client token will be');
                console.log('\tregenerated (default), or server token if -s is set.');
                break;
            case 'start':
                console.log('Usage: bhid start\n');
                console.log('\tThis command will start the daemon');
                console.log('\tYou might want to run "systemctl bhid start" instead');
                break;
            case 'stop':
                console.log('Usage: bhid stop\n');
                console.log('\tThis command will stop the daemon');
                console.log('\tYou might want to run "systemctl bhid stop" instead');
                break;
            default:
                console.log('Usage: bhid help <command>');
                process.exit(1);
        }
        break;
    case 'install':
        execCommand('cmd', process.argv.slice(2))
            .then(result => {
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'start':
        execDaemon()
            .then(result => {
                process.exit(result.code);
            })
            .catch(error => {
                console.log(error.message);
                process.exit(1);
            });
        break;
    case 'stop':
        execCommand('kill', [ pidPath ])
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
    case 'register':
    case 'auth':
    case 'create':
    case 'delete':
    case 'connect':
    case 'disconnect':
    case 'tree':
    case 'load':
    case 'redeem':
        execDaemon()
            .then(result => {
                if (result.code !== 0)
                    process.exit(result.code);
                return execCommand('cmd', process.argv.slice(2));
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
