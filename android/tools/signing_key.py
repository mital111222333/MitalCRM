"""The permanent JUMAVOY signing key, made again on every build from one password (the repository secret
ANDROID_KEYSTORE_PASS) — the key itself is never stored anywhere. The same password always gives the same RSA key and
certificate, so every new APK installs over the old one.  Usage: KS_PASS=… python3 signing_key.py out.p12"""
import hashlib, os, sys, datetime
from Crypto.PublicKey import RSA
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12

pw = os.environ.get('KS_PASS', '')
if len(pw) < 16: sys.exit('ANDROID_KEYSTORE_PASS must be at least 16 characters')
seed = hashlib.pbkdf2_hmac('sha256', pw.encode(), b'jumavoy-apk-signing-key-v1', 300_000)

class Stream:  # deterministic random bytes: SHAKE-256 of the seed, read in order
    def __init__(self, s): self.s, self.n = s, 0
    def __call__(self, k):
        out = hashlib.shake_256(self.s + self.n.to_bytes(8, 'big')).digest(k); self.n += 1; return out

rsa = RSA.generate(2048, randfunc=Stream(seed))
key = serialization.load_pem_private_key(rsa.export_key('PEM', pkcs=8), password=None)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'JUMAVOY'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'MITAL'), x509.NameAttribute(NameOID.COUNTRY_NAME, 'UZ')])
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1)
        .not_valid_before(datetime.datetime(2026, 1, 1)).not_valid_after(datetime.datetime(2056, 1, 1))
        .sign(key, hashes.SHA256()))
open(sys.argv[1], 'wb').write(pkcs12.serialize_key_and_certificates(b'jumavoy', key, cert, None, serialization.BestAvailableEncryption(pw.encode())))
print('signing certificate SHA-256:', cert.fingerprint(hashes.SHA256()).hex()[:16], '…')
