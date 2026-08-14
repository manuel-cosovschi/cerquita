# Despliegue

> Todavía no hay infraestructura real provisionada. Esto documenta lo que el
> código espera del entorno.

## Antes de desplegar

La app **se niega a arrancar** en producción con providers mock de pagos o
storage. Es intencional: un build que simula cobrar sin mover plata tiene que
fallar ruidosamente.

Checklist:

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` de al menos 32 caracteres, generado al azar y rotable
- [ ] `PAYMENT_PROVIDER=mercadopago` + `MERCADOPAGO_ACCESS_TOKEN`
- [ ] `STORAGE_PROVIDER=s3` + credenciales (falta implementar el provider)
- [ ] `CORS_ORIGINS` con los dominios reales
- [ ] `DATABASE_URL` apuntando a PostgreSQL **con PostGIS**
- [ ] Migraciones aplicadas con `db:migrate:deploy`, nunca con `migrate dev`

## Componentes

| Componente | Requisito |
|---|---|
| API | Node 22, sin estado, escalable horizontalmente |
| PostgreSQL | 16+ con PostGIS 3.4+ |
| Redis | 7+ |
| web / admin | Node 22 o export estático + funciones |
| Storage | Bucket compatible con S3 |

## Escalado horizontal

La API no guarda estado en memoria. El scheduler de subastas usa row locks, así
que varias instancias son seguras: la que toma el lock cierra la subasta y las
otras la ven ya cerrada.

Lo que **no** escala horizontalmente todavía: el event bus es in-process, así que
los suscriptores corren en la instancia que publicó. Antes de escalar en serio
hay que moverlo a Redis/BullMQ. El contrato es el payload, no el transporte.

## Health checks

- Liveness → `/api/health`. No toca dependencias a propósito: un hipo de la base
  no debe reiniciar pods sanos.
- Readiness → `/api/ready`. Verifica la base, para que una instancia arrancando
  no reciba tráfico antes de poder responder.

## Migraciones

```bash
pnpm --filter @cerquita/api db:migrate:deploy
```

Aplica sólo migraciones existentes. Nunca correr `migrate dev` contra producción.

## Observabilidad

Implementado: logs estructurados, request id correlacionado y devuelto en la
respuesta, audit log de acciones administrativas, health endpoints.

Pendiente: adapter de error tracking (Sentry o equivalente), métricas y trazas.
