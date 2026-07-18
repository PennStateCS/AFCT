# HTTPS certificates

AFCT creates a self-signed certificate during the first startup. HTTPS works immediately, but browsers display a warning because the certificate is not trusted.

A self-signed certificate is reasonable for restricted testing. A public or institution-facing deployment should use a certificate issued by a trusted certificate authority.

## Install a certificate in AFCT

1. Sign in as an administrator.
2. Open **Admin Menu > System Settings**.
3. Select **TLS Certificate**.
4. Upload the certificate in PEM format.
5. Upload the matching private key in PEM format.
6. Add any intermediate or chain certificates supplied by the certificate authority.
7. Select **Apply certificate**.

AFCT checks that the key matches the certificate, the certificate has not expired, and both files use supported formats. Invalid files are rejected without replacing the current certificate.

The new certificate normally becomes active within about 15 seconds. A container restart is not required.

AFCT does not display the private key after it is uploaded.

## Generate a certificate signing request

Use the TLS settings page to generate a certificate signing request, or CSR. Submit the CSR to your institution or certificate authority.

The CSR contains public information. It does not expose the private key.

## Return to the self-signed certificate

Select **Reset to self-signed** in the TLS settings page.

## Obtain a trusted certificate

Public deployments can use a certificate from [Let's Encrypt](https://letsencrypt.org/), often through `certbot`. Internal deployments may use an institutional certificate authority.

## Troubleshoot certificate warnings

A warning is expected with the default self-signed certificate. A warning on a previously trusted deployment can mean:

- The certificate expired
- The wrong certificate was installed
- The hostname is missing from the certificate
- An intermediate certificate is missing
- DNS points to a different server

Check the certificate installed under **Admin Menu > System Settings > TLS Certificate** and renew or replace it as needed.
