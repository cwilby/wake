import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';

function encryptionKey() {
    const encoded = process.env.WAKE_SSH_KEY_ENCRYPTION_KEY;
    if (!encoded) throw new Error('Set WAKE_SSH_KEY_ENCRYPTION_KEY to a base64-encoded 32-byte secret before adding or using SSH shutdown strategies.');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('WAKE_SSH_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte secret (generate one with: openssl rand -base64 32).');
    return key;
}

export function encryptPrivateKey(privateKey) {
    const key = encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    return `${ENVELOPE_VERSION}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptPrivateKey(envelope) {
    const key = encryptionKey();
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = String(envelope ?? '').split(':');
    if (version !== ENVELOPE_VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
        throw new Error('Stored SSH key has an invalid encrypted format.');
    }
    try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encodedIv, 'base64'));
        decipher.setAuthTag(Buffer.from(encodedTag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        throw new Error('Unable to decrypt a stored SSH key. Check WAKE_SSH_KEY_ENCRYPTION_KEY; it must match the key used when the SSH strategy was saved.');
    }
}

function isEncrypted(value) {
    return Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);
}

export async function encryptLegacySshKeys(db) {
    const { results } = await db.query("SELECT id, private_key, private_key_encrypted FROM shutdown_strategy WHERE type = 'ssh' AND private_key IS NOT NULL");
    if (!results.length) return;

    // Validate the configured secret before changing any rows.
    encryptionKey();
    for (const row of results) {
        if (isEncrypted(row.private_key_encrypted)) {
            decryptPrivateKey(row.private_key);
            continue;
        }
        const encrypted = encryptPrivateKey(row.private_key);
        await db.query('UPDATE shutdown_strategy SET private_key = ?, private_key_encrypted = 1 WHERE id = ? AND private_key_encrypted = 0', [encrypted, row.id]);
        console.log(`Encrypted stored SSH key for shutdown strategy ${row.id}`);
    }
}
