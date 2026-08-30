"""Gera as variáveis VAPID usadas pelo Web Push (execute apenas uma vez)."""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def base64url(value: bytes) -> str:
	return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


private_key = ec.generate_private_key(ec.SECP256R1())
private_pem = private_key.private_bytes(
	encoding=serialization.Encoding.PEM,
	format=serialization.PrivateFormat.PKCS8,
	encryption_algorithm=serialization.NoEncryption(),
).decode("ascii").strip().replace("\n", "\\n")
public_key = private_key.public_key().public_bytes(
	encoding=serialization.Encoding.X962,
	format=serialization.PublicFormat.UncompressedPoint,
)

print(f"VAPID_PUBLIC_KEY={base64url(public_key)}")
print(f"VAPID_PRIVATE_KEY={private_pem}")
print("VAPID_CONTACT=mailto:admin@computicket.local")
