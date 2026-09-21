# MERCORA

Privacy-first second-hand marketplace designed for Tor Onion Services.

## Alcance actual

MERCORA incluye la base funcional de la web pública y la consola administrativa:

- cuentas pseudónimas y sesiones endurecidas;
- catálogo, búsqueda y categorías conectados al backend;
- fichas de anuncios y perfiles públicos de vendedores;
- área de vendedor para tiendas y anuncios;
- carrito persistente y creación atómica de pedidos en awaiting_payment;
- moderación, reputación, promociones, categorías y gestión Web/CMS;
- textos públicos y contenido legal versionados y editables;
- Admin Control API local con START/STOP/RESTART/STATUS/HEALTH_CHECK/RECOVER;
- PostgreSQL maintenance, backup/verification/restore;
- controles operativos de Docker, Tor y Onion Service.

## Directiva de seguridad

Optimizar MERCORA para el máximo nivel técnicamente alcanzable de seguridad, privacidad, disponibilidad, resistencia ante ataques y protección de infraestructura. No sacrificar seguridad por simplicidad, coste o velocidad.

## Gating de producción restante

Los bloqueos de producción restantes son el runtime real Docker/WSL, la validación física del Onion Service, el flujo autenticado de pago, la implementación aislada de wallets/custodia, observación blockchain/reconciliación, retiros, RBAC/MFA y la revisión final de seguridad y recuperación.

MERCORA no afirma anonimato o seguridad absolutos. Las afirmaciones de seguridad deben seguir siendo verificables mediante evidencia.
