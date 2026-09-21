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
