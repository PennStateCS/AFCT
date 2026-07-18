# HTTPS certificates

AFCT creates a self-signed certificate during the first startup. HTTPS works immediately, but browsers display a warning because the certificate is not trusted.

A self-signed certificate is reasonable for restricted testing. A public or institution-facing deployment should use a certificate issued by a trusted certificate authority.

## Get a free certificate with Let's Encrypt (recommended for public servers)

If your server is reachable from the public internet, AFCT can obtain and automatically renew a browser-trusted certificate from [Let's Encrypt](https://letsencrypt.org/) with no external tools.

Requirements:

- A domain name that resolves to this server in public DNS.
- Port 80 reachable from the internet. Let's Encrypt fetches a one-time file over plain HTTP at that domain to confirm you control it.
- The domain should match your configured URL (`NEXTAUTH_URL`).

Steps:

1. Sign in as an administrator and open **System Settings**.
2. Find **TLS Certificate** and select **Get a free certificate (Let's Encrypt)**.
3. Confirm the domain (prefilled from your configured URL) and enter a contact email. Let's Encrypt uses the email only for expiry and policy notices.
4. Optionally turn on **Use staging** to run a test issuance first. Staging issues an untrusted test certificate but confirms your DNS and port 80 are set up correctly without spending the weekly rate limit. Turn it off and request again once the test succeeds.
5. Agree to the Let's Encrypt terms of service and select **Request certificate**. Issuance usually takes under a minute.

After it succeeds, AFCT renews the certificate automatically before it expires. The TLS status shows the managed domain and an **Auto-renewing** badge; select **Turn off auto-renewal** to stop managing it (the current certificate stays in place).

Installing a trusted certificate also enables HSTS, which tells browsers to use HTTPS for this domain from then on.

If issuance fails, the previous certificate is kept, so the site stays reachable. The most common causes are DNS not pointing at this server or port 80 being blocked. Because Let's Encrypt rate-limits failed attempts, use the staging option while sorting out DNS or firewall issues.

## Install a certificate in AFCT

1. Sign in as an administrator.
2. Open **System Settings**.
3. Find **TLS Certificate**.
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

Public deployments can use the built-in [Let's Encrypt](https://letsencrypt.org/) flow described above. Internal deployments that are not publicly reachable can upload a certificate from an institutional certificate authority, or generate a CSR from the TLS settings page and have it signed.

## Troubleshoot certificate warnings

A warning is expected with the default self-signed certificate. A warning on a previously trusted deployment can mean:

- The certificate expired
- The wrong certificate was installed
- The hostname is missing from the certificate
- An intermediate certificate is missing
- DNS points to a different server

Check the certificate installed under **System Settings > TLS Certificate** and renew or replace it as needed.
