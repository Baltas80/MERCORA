# MERCORA Admin Console

La consola Windows/Tauri es el centro privado de administración de MERCORA. La interfaz está separada del plano privilegiado:

Admin UI -> Tauri/Rust bridge -> 127.0.0.1 Admin Control API -> operaciones allow-listed

No existe una shell de comandos dentro de la interfaz.

## Gestión operativa

- START / STOP / RESTART de MERCORA.
- START / STOP / RESTART de MERCORA, PostgreSQL y Tor.
- STATUS, HEALTH CHECK y RECOVER.
- Recuperación orientada al componente afectado.
- Tras una recuperación se ejecutan las comprobaciones de runtime/dependencias, backend, PostgreSQL, Tor, Onion Service y almacenamiento en un orden explícito antes de declarar el estado final.
- Logs sanitizados por servicio.
- Métricas de contenedores.
- Migración de la base administrativa mediante una migración SQL fija.
- Backups PostgreSQL en formato custom.
- Verificación de backups.
- Restauración con doble confirmación y backup automático previo.

## Gestión completa del marketplace

La consola administra usuarios, tiendas, anuncios, pedidos, reportes, promociones, descuentos, categorías, reputación, escrow y configuración de la web mediante operaciones allow-listed y auditadas.

## Web y contenido editorial

La sección **Web** incluye un editor separado para los textos públicos que pueden necesitar corrección rápida sin modificar código:

- nombre del sitio;
- condiciones de uso;
- política de privacidad;
- normas de publicación;
- enunciado/aviso;
- mensaje de mantenimiento;
- aviso del pie;
- título y descripción de portada;
- textos de los botones de compra y venta.

Cada guardado crea una **nueva versión** con actor y fecha. El administrador puede consultar el historial y restaurar una versión anterior. Los avisos opcionales (`announcement`, `maintenance_message`, `footer_notice`) pueden despublicarse inmediatamente.

El contenido administrativo se trata como **texto plano**: el servicio rechaza HTML y esquemas `javascript:`. La interfaz utiliza `textContent` para la vista previa. No se permite introducir HTML/JS desde este editor.

Las modificaciones generan entradas en `admin_audit_log`. La consola no proporciona acceso SQL al administrador.

## Seguridad

- API de administración ligada a localhost.
- Autenticación Bearer con comparación en tiempo constante.
- Token de la consola únicamente en memoria.
- Bloqueo automático por inactividad tras 15 minutos; el temporizador se inicia al autenticarse y se cancela al cerrar sesión.
- Endpoints allow-listed.
- Servicios Docker allow-listed.
- Procesos lanzados con shell=false.
- Validación estricta de UUID, slugs, estados, límites y tipos de descuento.
- No se aceptan SQL, comandos o rutas de fichero arbitrarias desde la UI.
- Los diagnósticos de error del API pasan por un sanitizador que elimina rutas de sistema y valores asociados a `token`, `password` o `secret`, además de limitar su longitud.
- Los logs de servicio y diagnósticos no deben exponer credenciales, semillas, claves privadas ni autorizaciones.
- Las claves privadas de Tor y credenciales de pago quedan fuera de la frontera administrativa.

## Migraciones

Los scripts montados en docker-entrypoint-initdb.d/ solo se ejecutan automáticamente cuando PostgreSQL inicializa un volumen nuevo. Para instalaciones ya existentes, la consola incorpora MIGRAR BD, que ejecuta únicamente las migraciones administrativas comprometidas en el repositorio, incluida `007_site_content_versions.sql` para el historial editorial.

## Verificación CI

El CI general y la pipeline específica de la consola ejecutan además el test de regresión de seguridad del bloqueo por inactividad de la UI (`admin-console/ui/security.test.js`). La pipeline específica de la consola ejecuta comprobación Rust (`cargo check`), tests Rust (`cargo test`), validación de sintaxis JavaScript y build del instalador Windows NSIS. La pipeline general también comprueba explícitamente la sintaxis de `server/admin-control-api.test.js` para evitar que el nuevo conjunto de pruebas quede fuera de la validación sintáctica. El conjunto de dependencias del frontend administrativo todavía no dispone de un `package-lock.json` propio, por lo que esa instalación continúa usando `npm install`; convertirla a `npm ci` queda como mejora de reproducibilidad pendiente hasta generar y revisar el lockfile completo.

## Estado de producción

El código administrativo queda integrado y preparado para la infraestructura real, pero la aprobación de producción requiere ejecutar en el equipo objetivo la build Windows, Docker/WSL, PostgreSQL, Tor, Onion Service y los procedimientos de backup/restore de extremo a extremo. No se marcan esas verificaciones como superadas hasta que se ejecutan realmente.

El editor de contenido está implementado en código y con tests unitarios; su ejecución contra PostgreSQL real queda pendiente de disponer del runtime Docker operativo.

La ejecución CI del `HEAD` actual debe considerarse **PENDIENTE** hasta que GitHub publique los workflow runs correspondientes; la integración del código por sí sola no se considera evidencia de que los tests hayan pasado.

## Web pública conectada a datos reales

La portada consume categorías, anuncios publicados y reputación verificada desde PostgreSQL mediante la capa de datos pública. No se utilizan productos ficticios para representar el catálogo operativo.

Las rutas públicas soportadas incluyen:

- `/api/categories`
- `/api/listings`
- `/api/sellers/:displayName`
- `/api/site-config`

La web también dispone de autenticación pseudónima real, sesiones y área de vendedor. Las contraseñas se almacenan mediante el módulo scrypt existente y las sesiones utilizan tokens aleatorios almacenando solo su hash.

En el Onion Service actual, que publica HTTP, `MERCORA_COOKIE_SECURE=false` es el modo de compatibilidad necesario para que el navegador acepte la sesión. Si se despliega el servicio público detrás de HTTPS, debe establecerse `MERCORA_COOKIE_SECURE=true`. HttpOnly y SameSite=Strict permanecen activos en ambos casos.

El administrador puede bloquear el registro de vendedores y la creación de nuevos anuncios desde la consola; esos controles se validan también en el backend y no dependen exclusivamente de la UI.

## Flujos web conectados

La web pública actual incluye:

- catálogo real desde PostgreSQL;
- búsqueda y filtrado por categoría;
- ficha de anuncio;
- perfil público de vendedor con ventas verificadas y anuncios activos;
- cuenta pseudónima con registro, inicio/cierre de sesión y sesión revocable;
- área de vendedor para crear tiendas y anuncios;
- carrito persistente en el navegador;
- creación de pedidos reales en estado `awaiting_payment`;
- cancelación de pedidos no pagados desde la cuenta;
- páginas de condiciones, privacidad y normas de publicación.

La capa web no ejecuta SQL recibido del navegador. Los endpoints del servidor validan identificadores, límites, estados y activos antes de tocar PostgreSQL. Las operaciones de pago blockchain y custodia permanecen fuera del checkout hasta que el servicio de wallets/custodia real esté validado.
