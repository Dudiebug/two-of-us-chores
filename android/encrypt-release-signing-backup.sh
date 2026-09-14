#!/usr/bin/env bash
set -euo pipefail

PUBLIC_KEY="${1:-android/release-signing-recovery-public.pem}"
INPUT="${2:-release-1-signing-backup.tar.gz}"
OUTPUT="${3:-dist/release-1-signing-recovery-encrypted.tar.gz}"

test -s "$PUBLIC_KEY"
test -s "$INPUT"

openssl rand -base64 48 > signing-backup.secret
chmod 600 signing-backup.secret
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$INPUT" \
  -out signing-backup.enc \
  -pass file:signing-backup.secret
openssl pkeyutl -encrypt \
  -pubin -inkey "$PUBLIC_KEY" \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -in signing-backup.secret \
  -out signing-secret.enc

cat > signing-recovery-README.txt <<'EOF'
Two of Us Chores - Release 1 signing-key recovery

This archive is envelope-encrypted. Keep the matching recovery PEM file separately.

Recover the one-time secret:
  openssl pkeyutl -decrypt -inkey RECOVERY_KEY.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in signing-secret.enc -out signing-backup.secret

Decrypt the PWABuilder signing bundle:
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in signing-backup.enc -out release-1-signing-backup.tar.gz -pass file:signing-backup.secret

The decrypted tarball contains signing.keystore and signing-key-info.txt. Keep both confidential.
EOF

tar -czf "$OUTPUT" signing-backup.enc signing-secret.enc signing-recovery-README.txt
rm -f signing-backup.secret signing-backup.enc signing-secret.enc signing-recovery-README.txt
