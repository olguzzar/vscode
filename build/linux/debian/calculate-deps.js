"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePackageDeps = void 0;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path = require("path");
const manifests = require("../../../cgmanifest.json");
const dep_lists_1 = require("./dep-lists");
function generatePackageDeps(files, arch, sysroot) {
    const dependencies = files.map(file => calculatePackageDeps(file, arch, sysroot));
    const additionalDepsSet = new Set(dep_lists_1.additionalDeps);
    dependencies.push(additionalDepsSet);
    return dependencies;
}
exports.generatePackageDeps = generatePackageDeps;
// Based on https://source.chromium.org/chromium/chromium/src/+/main:chrome/installer/linux/debian/calculate_package_deps.py.
function calculatePackageDeps(binaryPath, arch, sysroot) {
    try {
        if (!((0, fs_1.statSync)(binaryPath).mode & fs_1.constants.S_IXUSR)) {
            throw new Error(`Binary ${binaryPath} needs to have an executable bit set.`);
        }
    }
    catch (e) {
        // The package might not exist. Don't re-throw the error here.
        console.error('Tried to stat ' + binaryPath + ' but failed.');
    }
    // Get the Chromium dpkg-shlibdeps file.
    const chromiumManifest = manifests.registrations.filter(registration => {
        return registration.component.type === 'git' && registration.component.git.name === 'chromium';
    });
    const dpkgShlibdepsUrl = `https://raw.githubusercontent.com/chromium/chromium/${chromiumManifest[0].version}/third_party/dpkg-shlibdeps/dpkg-shlibdeps.pl`;
    const dpkgShlibdepsScriptLocation = `${(0, os_1.tmpdir)()}/dpkg-shlibdeps.pl`;
    const result = (0, child_process_1.spawnSync)('curl', [dpkgShlibdepsUrl, '-o', dpkgShlibdepsScriptLocation]);
    if (result.status !== 0) {
        throw new Error('Cannot retrieve dpkg-shlibdeps. Stderr:\n' + result.stderr);
    }
    const cmd = [dpkgShlibdepsScriptLocation, '--ignore-weak-undefined'];
    switch (arch) {
        case 'amd64':
            cmd.push(`-l${sysroot}/usr/lib/x86_64-linux-gnu`, `-l${sysroot}/lib/x86_64-linux-gnu`);
            break;
        case 'armhf':
            cmd.push(`-l${sysroot}/usr/lib/arm-linux-gnueabihf`, `-l${sysroot}/lib/arm-linux-gnueabihf`);
            break;
        case 'arm64':
            cmd.push(`-l${sysroot}/usr/lib/aarch64-linux-gnu`, `-l${sysroot}/lib/aarch64-linux-gnu`);
            break;
    }
    cmd.push(`-l${sysroot}/usr/lib`);
    cmd.push('-O', '-e', path.resolve(binaryPath));
    const dpkgShlibdepsResult = (0, child_process_1.spawnSync)('perl', cmd, { cwd: sysroot });
    if (dpkgShlibdepsResult.status !== 0) {
        throw new Error(`dpkg-shlibdeps failed with exit code ${dpkgShlibdepsResult.status}. stderr:\n${dpkgShlibdepsResult.stderr} `);
    }
    const shlibsDependsPrefix = 'shlibs:Depends=';
    const requiresList = dpkgShlibdepsResult.stdout.toString('utf-8').trimEnd().split('\n');
    let depsStr = '';
    for (const line of requiresList) {
        if (line.startsWith(shlibsDependsPrefix)) {
            depsStr = line.substring(shlibsDependsPrefix.length);
        }
    }
    const requires = new Set(depsStr.split(', ').sort());
    return requires;
}