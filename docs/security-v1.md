# Configuración y seguridad v1

## Variables obligatorias

- `SECRETS_ENCRYPTION_KEY`: 32 bytes codificados en base64. Cifra claves SOL, contraseñas de certificados y secretos recuperables mediante AES-256-GCM.
- `API_KEY_PEPPER`: secreto aleatorio de al menos 32 caracteres. Se usa como clave HMAC al almacenar API keys.

Ambos valores deben ser diferentes por ambiente y permanecer fuera del repositorio. En producción deben proceder de un gestor de secretos.

## Controles HTTP

- Helmet y eliminación de `X-Powered-By`.
- CORS deshabilitado si no se configura una lista explícita.
- Solo orígenes HTTPS en producción.
- Rate limiting global por IP; el endpoint de salud queda excluido.
- `X-Request-Id` validado o generado para correlación.
- Errores con `application/problem+json` sin exponer stack traces.
- Validación global que elimina o rechaza propiedades desconocidas.
- Soporte explícito para proxies confiables mediante `TRUST_PROXY_HOPS`.

## Formato de secretos cifrados

```text
v1.<iv-base64url>.<auth-tag-base64url>.<ciphertext-base64url>
```

El contexto de cifrado debe identificar el tenant y el propósito, por ejemplo `tenant:<id>:sol-password`. Cambiar el contexto hace fallar la autenticación del cifrado.

## API keys

Las API keys completas se mostrarán una sola vez. La base de datos conservará únicamente:

- Prefijo visible.
- HMAC-SHA-256 de la key usando `API_KEY_PEPPER`.
- Ambiente, scopes, expiración y revocación.

La creación y autenticación efectiva de API keys se implementará junto con empresas y aplicaciones.
