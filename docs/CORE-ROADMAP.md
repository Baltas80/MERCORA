# MERCORA Core Roadmap

## Implementado

- Secure repository baseline and threat-model invariants.
- Tor Onion Service deployment structure.
- Local Node web server with security headers and rate limiting.
- Non-root container image with restricted capabilities.
- PostgreSQL marketplace schema and administrative migrations.
- Pseudonymous account registration, login, logout and session handling.
- Public catalog, search, categories, listing detail and seller profiles.
- Public seller workspace with store and listing creation.
- Persistent browser cart and atomic order creation through awaiting_payment.
- Admin Console with marketplace management, moderation, reputation, escrow controls, backups, logs, metrics and recovery.
- Versioned editable public/site content with audit history.
- Legal/publication content slots editable from the Admin Console.
- CI syntax, dependency, secret-material, container-isolation and CodeQL checks.
- Windows/Tauri build pipeline with icon generation and verification.

## Trabajo pendiente de producción

1. Ejecutar la suite automatizada completa contra el HEAD actual y resolver cualquier fallo.
2. Validar Docker + PostgreSQL + Node.js de extremo a extremo en el equipo Windows/WSL objetivo.
3. Completar el despliegue real de Tor Onion Service y la validación física con navegador.
4. Completar la iniciación autenticada del pago y las transiciones de pago del pedido.
5. Implementar y validar servicios de wallet/custodia aislados para BTC, LTC y XMR.
6. Implementar observadores blockchain, detección de depósitos, confirmaciones y reconciliación.
7. Implementar autorización/ejecución de retiros con aislamiento de custodia y recuperación.
8. Completar RBAC/MFA de producción para operaciones destructivas y financieras de la consola.
9. Completar pruebas de backup/restore y recuperación ante desastres.
10. Realizar revisión de seguridad final y checklist de release.

La integración de wallets en producción permanece deshabilitada hasta validar las invariantes de custodia, reconciliación, recuperación y revisión de seguridad.
