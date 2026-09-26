import test from 'node:test';
import assert from 'node:assert/strict';
import { commandForSshHost, defaultShutdownCommands, normalizeSshHost } from '../app/utils/shutdown.js';

test('root SSH uses shutdown directly while non-root and custom commands are preserved', () => {
    assert.equal(commandForSshHost(defaultShutdownCommands.linux, 'root@192.168.86.2'), 'shutdown -h now');
    assert.equal(commandForSshHost(defaultShutdownCommands.linux, 'wake@192.168.86.2'), 'sudo shutdown -h now');
    assert.equal(commandForSshHost('systemctl poweroff', 'root@192.168.86.2'), 'systemctl poweroff');
});

test('escaped at signs in SSH targets are normalized for execFile arguments', () => {
    assert.equal(normalizeSshHost(String.raw`root\@192.168.86.2`), 'root@192.168.86.2');
});
