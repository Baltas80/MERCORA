# Upload security

User files are hostile input.

Images are decoded and re-encoded before storage, which removes unneeded image metadata and prevents original bytes from becoming directly served objects. PDFs are quarantined with a pending scan state.

Production must connect quarantine to an approved malware scanner in an isolated service and expose an object only after a clean result. Scanner failure is fail-closed.

Objects are outside the web root with random server-generated keys. Original filenames are never storage paths. Each object has a SHA-256 digest and explicit purpose. Size and MIME allowlists are enforced server-side.