# MERCORA Admin Console

La consola Windows/Tauri es el centro privado de administración de MERCORA. La interfaz está separada del plano privilegiado:

Admin UI -> Tauri/Rust bridge -> 127.0.0.1 Admin Control API -> operaciones allow-listed

No existe una shell de comandos dentro de la interfaz.

## Gestión operativa

- START / STOP / RESTART de MERCORA.
- START / RESTART de Tor.
- STATUS, HEALTH CHECK y RECOVER.
- Recuperación orientada al componente afectado.
- Logs sanitizados por servicio.
- Métricas de contenedores.
- Migración de la base administrativa mediante una migración SQL fija.
- Backups PostgreSQL en formato custom.
- Verificación de backups.
- Restauración con doble confirmación y backup automático previo.

## Gestión completa del marketplace

### Usuarios
- Buscar usuarios.
- Ver estado y condición de baneo.
- Activar / congelar / deshabilitar cuentas.
- Ban y unban con motivo y expiración opcional.

### Tiendas
- Crear tiendas.
- Asignar y reasignar propietarios.
- Desasignar propietarios.
- Activar, suspender, cerrar o dejar en borrador.
- Consultar el histórico de asignaciones.

### Anuncios
- Buscar y filtrar anuncios.
- Bloquear / desbloquear.
- Ver vendedor, categoría, precio y estado.

### Pedidos
- Consultar pedidos y estado.
- Avanzar únicamente por transiciones de estado permitidas.
- No se permite modificar saldos ni el ledger desde esta consola.

### Reportes y moderación
- Bandeja de reportes.
- Filtrado por estado.
- Marcar como abierto, en revisión, resuelto o descartado.
- Añadir notas internas y registrar quién gestionó el reporte.

### Promociones
- Crear códigos manuales o generados.
- Descuentos porcentuales o cantidades fijas.
- Límite de redenciones.
- Mínimo de pedido.
- Ventana de validez.
- Desactivar promociones.
- El código completo se muestra una sola vez y no se almacena en texto plano.

### Descuentos
- Reglas globales, por tienda, anuncio o categoría.
- Porcentaje o cantidad fija.
- Ventanas de validez.
- Activación/desactivación.

### Categorías
- Crear categorías.
- Activar/desactivar categorías.

### Web
- Nombre del sitio.
- Modo público / mantenimiento / restringido.
- Aviso general.
- Mensaje de mantenimiento.
- Permitir o bloquear nuevos anuncios.
- Permitir o bloquear registro de vendedores.
- Aviso de pie.
- Selección de anuncios destacados de portada.

### Auditoría
Todas las acciones administrativas de datos y las operaciones de mantenimiento relevantes generan registros en admin_audit_log. Los metadatos administrativos no deben contener secretos.

## Seguridad

- API de administración ligada a localhost.
- Autenticación Bearer con comparación en tiempo constante.
- Token de la consola únicamente en memoria.
- Endpoints allow-listed.
- Servicios Docker allow-listed.
- Procesos lanzados con shell=false.
- Validación estricta de UUID, slugs, estados, límites y tipos de descuento.
- No se aceptan SQL, comandos o rutas de fichero arbitrarias desde la UI.
- Los diagnósticos eliminan líneas con contraseñas, tokens, semillas, claves privadas y autorizaciones.
- Las claves privadas de Tor y credenciales de pago quedan fuera de la frontera administrativa.

## Migraciones

Los scripts montados en docker-entrypoint-initdb.d/ solo se ejecutan automáticamente cuando PostgreSQL inicializa un volumen nuevo. Para instalaciones ya existentes, la consola incorpora MIGRAR BD, que ejecuta únicamente la migración administrativa comprometida en el repositorio.

## Backups

Los backups se guardan únicamente en el directorio gestionado backups/ con nombres generados por el sistema. La consola nunca acepta una ruta arbitraria.

La restauración exige:
1. Seleccionar un backup existente.
2. Confirmar la operación.
3. Escribir RESTORE_MERCORA.
4. Crear automáticamente un backup preventivo de la base actual.
5. Ejecutar la restauración.

## Estado de producción

El código administrativo queda integrado y preparado para la infraestructura real, pero la aprobación de producción requiere ejecutar en el equipo objetivo la build Windows, Docker/WSL, PostgreSQL, Tor, Onion Service y los procedimientos de backup/restore de extremo a extremo. No se marcan esas verificaciones como superadas hasta que se ejecutan realmente.


## Vinculación de la web

La consola administra una configuración pública controlada (runtime/site-config.json) que el servidor expone mediante el endpoint de solo lectura /api/site-config. La misma pantalla permite editar título, descripción y textos de llamada a la acción de la portada, además de avisos y modo de mantenimiento. La aplicación pública puede aplicar nombre, avisos, modo de mantenimiento y restricciones de registro sin ejecutar contenido administrativo arbitrario.

El directorio runtime se monta en el contenedor de aplicación como solo lectura. La configuración generada se excluye de Git. La preview de GitHub Pages continúa siendo una superficie estática aislada y no se considera una instalación de producción.


## Reputación y ventas verificadas

La reputación de vendedores está vinculada a compras verificadas y no a un contador editable.

- Una valoración solo puede existir cuando el pedido está en estado `completed`.
- El comprador debe ser el comprador real del pedido.
- El vendedor valorado debe aparecer en `order_items` de ese pedido.
- La autoevaluación está bloqueada.
- En un pedido con varios vendedores, cada vendedor puede recibir su propia valoración.
- Una misma relación pedido + comprador + vendedor solo admite una valoración.
- Las valoraciones llevan estado `published`, `under_review` u `hidden`; ocultar o poner en revisión desde la consola exige un motivo y queda auditado.
- `verified_purchase_at` se valida en la base de datos y no debe ser generado por la interfaz pública.
- La reputación publicada se recalcula desde valoraciones verificadas.

### Ventas reales del vendedor

La vista `seller_reputation` deriva las ventas desde `order_items` + `orders` y cuenta como venta verificada cada pedido completado que contiene al vendedor. También expone las unidades vendidas y la media de valoración.

La cifra pública que se mostrará junto al nombre del vendedor debe proceder de `verified_sales_count`, por ejemplo:

`MercoraShop · 1.284 ventas verificadas · ★ 4,92 · 247 valoraciones`

No se debe usar un campo editable de perfil para representar ventas. Las ventas canceladas, pendientes o disputadas que no hayan terminado en `completed` no incrementan el contador.

### Consola

El módulo **Reputación** permite:

- Buscar vendedores y consultar ventas verificadas, unidades, media y número de valoraciones.
- Buscar comentarios y filtrar por estado.
- Poner valoraciones en revisión, ocultarlas o volver a publicarlas.
- Consultar el vínculo interno con el pedido verificado.
- Recalcular los contadores denormalizados de `seller_profiles`.
- Mantener auditoría administrativa de las actuaciones.

La preview pública actual es estática y muestra datos de ejemplo únicamente para validar la presentación visual. El flujo de producción deberá consumir la vista/servicio de reputación del backend cuando la API transaccional pública quede conectada a PostgreSQL.

## Escrow / Mid-Escrow / Early Pay

La consola dispone de un módulo dedicado de pagos y liquidación.

- Escrow: activa o desactiva la retención para pedidos elegibles y permite abrir casos asociados a pedidos ya pagados.
- Mid-Escrow: permite autorizar una liberación parcial tras el estado shipped. El porcentaje se configura en la política.
- Early Pay: permite autorizar una liberación anticipada después de un retraso configurable y con un máximo porcentual.
- Release final: autoriza la parte restante al completar el pedido o al finalizar la ventana de disputa configurada.
- Refund: permite autorizar un reembolso cuando el pedido está cancelado o disputado.
- Freeze: congela un caso concreto y expira las autorizaciones pendientes.
- Custody Freeze: congela el plano de custodia global desde la consola; las operaciones de liquidación deben respetar este estado.

Las autorizaciones financieras son deliberadamente distintas de la ejecución. escrow_authorizations funciona como cola auditable para que el servicio aislado de settlement/custody ejecute el movimiento mediante el ledger de doble entrada. La consola no modifica ledger_entries ni saldos.

### Parámetros que conviene controlar desde la consola

Escrow activo, Mid-Escrow activo, porcentaje de Mid-Escrow, Early Pay activo, espera de Early Pay, porcentaje máximo de Early Pay, ventana de disputa, auto-release, obligación de escrow para vendedores nuevos, retención de vendedores nuevos, revisión por importe alto, umbral de importe alto y liberación final manual.

### Política operativa inicial propuesta

Para una primera puesta en producción usaría Escrow activado, Mid-Escrow al 50%, ventana de disputa de 48 horas y Early Pay desactivado hasta validar el flujo real. Después puede activarse únicamente para vendedores con historial suficiente, con un límite de Early Pay conservador y revisión manual de operaciones de importe alto.

Estos valores son política operativa configurable; no forman parte de una garantía de seguridad o de liquidez.

## Control integral recomendado

La consola debería quedar organizada en doce áreas:

1. Dashboard: salud, ventas, pedidos, escrow, retiros, reportes y alertas.
2. Usuarios: cuentas, sesiones, baneos, historial y actividad.
3. Vendedores/Tiendas: adjudicación, estado, límites y rendimiento.
4. Catálogo: anuncios, categorías, destacados y moderación.
5. Pedidos: estados, disputas y trazabilidad.
6. Pagos/Escrow: políticas, casos, autorizaciones, Mid-Escrow, Early Pay y reembolsos.
7. Tesorería/Custodia: depósitos, retiros, reconciliación y exposición por activo, siempre como control separado del ledger.
8. Riesgo: límites, operaciones de importe alto, velocidad, cuentas nuevas y señales de abuso.
9. Promociones: códigos, descuentos, campañas y vigencias.
10. Web/CMS: portada, avisos, mantenimiento y contenido controlado.
11. Operaciones: Docker, Tor, logs, métricas, backups y recuperación.
12. Seguridad/Auditoría: cambios administrativos, alertas, eventos de seguridad y revisiones.

Para las funciones financieras y destructivas recomiendo además RBAC + MFA, con al menos perfiles Owner, Finance, Moderator, Support, Operations y Read-only; y doble aprobación para retiros, releases o reembolsos importantes, cambio de custodia y restauraciones. Esto evita que la comodidad de tener todo en una sola consola se convierta en un único punto de fallo.
