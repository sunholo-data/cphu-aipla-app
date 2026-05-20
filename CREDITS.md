# Third-party assets

## Visual assets

### Københavns Universitet coat-of-arms logo

- **File**: [frontend/public/images/logo/ku-logo.svg](frontend/public/images/logo/ku-logo.svg)
- **Source**: [Ku-ucph-logo-svg.svg on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ku-ucph-logo-svg.svg)
- **Author**: Canconier (Wikimedia Commons user)
- **License**: [Creative Commons Attribution-Share Alike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- **Modifications**: None — file used as downloaded from Wikimedia Commons.
- **Usage**: Welcome-screen hero on AIPLA frontend, signalling
  Københavns Universitet's institutional involvement in the project.

### AIPLA "A" favicon

- **File**: [frontend/public/images/logo/sunholo-logo.svg](frontend/public/images/logo/sunholo-logo.svg)
- **Source**: AIPLA project scoping site (`~/Documents/clients/cph-uni/assets/favicon.svg`)
- **Author**: M (project lead)
- **License**: Internal project asset; licensing aligns with the AIPLA repo's overall licence
  (CC BY 4.0 docs / Apache 2.0 code per the scoping site `README.md`).
- **Usage**: Browser tab favicon + chat-message-bubble avatar.

### AIPLA wordmark SVG

- **File**: [frontend/public/images/logo/aipla-wordmark.svg](frontend/public/images/logo/aipla-wordmark.svg)
- **Source**: AIPLA project scoping site (`~/Documents/clients/cph-uni/assets/logo.svg`)
- **Author**: M
- **License**: Same as the favicon above.
- **Usage**: Available for any future spot where a wider mark is appropriate. Not yet referenced from code.

## Code-side dependencies

The forked AI Protocol Platform template ships its own credits via the
`uv` and `npm` lockfiles. See:

- [backend/uv.lock](backend/uv.lock) for Python dependencies.
- [frontend/package-lock.json](frontend/package-lock.json) for JS/TS dependencies.

The AIPLA repo itself remains under the parent template's licence
(Apache 2.0); see [LICENSE](LICENSE).
