# Despliegue con Docker Compose

El stack es independiente y contiene cuatro servicios:

- `postgres`: base de datos privada con volumen persistente.
- `migrate`: ejecuta `prisma migrate deploy` y termina correctamente.
- `api`: expone la API HTTP en `127.0.0.1:3100`.
- `worker`: procesa emisiones SUNAT, bajas y webhooks.

API, worker y migraciones reciben automáticamente esta conexión interna:

```text
postgresql://usuario:clave@postgres:5432/nuvex_billing?schema=public
```

`postgres` es el nombre DNS interno asignado por Docker Compose. La base de datos no publica el puerto 5432 hacia Internet.

## Preparación

```bash
cp .env.production.example .env.production
```

Complete todos los valores `REPLACE_WITH_...`. La contraseña PostgreSQL debe ser aleatoria y segura para URL, evitando caracteres que requieran codificación como `@`, `/`, `:` o `?`.

El archivo `.env.production` contiene secretos y está excluido de Git.

## Inicio

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

El orden automático es:

1. PostgreSQL inicia y supera su healthcheck.
2. Prisma ejecuta todas las migraciones pendientes.
3. API y worker comienzan únicamente si las migraciones terminaron bien.

## Verificación

```bash
curl http://127.0.0.1:3100/v1/health
docker compose --env-file .env.production logs --tail=100 api worker
```

La respuesta de salud esperada contiene `"status":"ok"`.

## Dominio

Configure Nginx, Caddy, Traefik o Cloudflare Tunnel para dirigir:

```text
https://billing-api.nuvex.pe -> http://127.0.0.1:3100
```

El proxy debe manejar HTTPS. Mantenga PostgreSQL y el worker sin puertos públicos.

## Actualización

```bash
git pull
docker compose --env-file .env.production up -d --build
docker image prune -f
```

Las migraciones se vuelven a ejecutar de forma idempotente antes de reiniciar API y worker.

## Copia de seguridad

Antes de actualizaciones importantes, respalde la base de datos y conserve el mismo valor de `SECRETS_ENCRYPTION_KEY`. Cambiar esa clave impide descifrar credenciales SUNAT y contraseñas de certificados existentes.
