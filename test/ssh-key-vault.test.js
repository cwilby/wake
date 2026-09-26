import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPrivateKey, decryptPrivateKey, encryptLegacySshKeys } from '../app/utils/ssh-key-vault.js';

const ORIGINAL_KEY = process.env.WAKE_SSH_KEY_ENCRYPTION_KEY;
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

test.beforeEach(() => { process.env.WAKE_SSH_KEY_ENCRYPTION_KEY = TEST_KEY; });
test.after(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.WAKE_SSH_KEY_ENCRYPTION_KEY;
    else process.env.WAKE_SSH_KEY_ENCRYPTION_KEY = ORIGINAL_KEY;
});

test('encrypts private keys and decrypts them without changing their contents', () => {
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nline one\nline two\n-----END OPENSSH PRIVATE KEY-----\n';
    const encrypted = encryptPrivateKey(privateKey);
    assert.notEqual(encrypted, privateKey);
    assert.match(encrypted, /^v1:/);
    assert.equal(decryptPrivateKey(encrypted), privateKey);
});

test('rejects a modified encrypted key', () => {
    const encrypted = encryptPrivateKey('secret key');
    const pieces = encrypted.split(':');
    pieces[3] = `${pieces[3].slice(0, -2)}AA`;
    assert.throws(() => decryptPrivateKey(pieces.join(':')), /Unable to decrypt/);
});

test('encrypts legacy plaintext keys and validates existing encrypted keys', async () => {
    const privateKey = 'legacy private key\n';
    const rows = [
        { id: 1, private_key: privateKey, private_key_encrypted: 0 },
        { id: 2, private_key: encryptPrivateKey('already encrypted'), private_key_encrypted: 1 }
    ];
    const updates = [];
    const fakeDb = {
        async query(sql, parameters) {
            if (sql.startsWith('SELECT')) return { results: rows };
            updates.push(parameters);
            return { results: { affectedRows: 1 } };
        }
    };
    await encryptLegacySshKeys(fakeDb);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1], 1);
    assert.notEqual(updates[0][0], privateKey);
    assert.equal(decryptPrivateKey(updates[0][0]), privateKey);
});

test('requires a valid 32-byte encryption key', () => {
    delete process.env.WAKE_SSH_KEY_ENCRYPTION_KEY;
    assert.throws(() => encryptPrivateKey('secret'), /WAKE_SSH_KEY_ENCRYPTION_KEY/);
    process.env.WAKE_SSH_KEY_ENCRYPTION_KEY = 'not base64 key';
    assert.throws(() => encryptPrivateKey('secret'), /32-byte secret/);
});
