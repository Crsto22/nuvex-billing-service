import { Global, Module } from '@nestjs/common';
import { SecretCryptoService } from './secret-crypto.service';
import { TokenHashService } from './token-hash.service';

@Global()
@Module({
  providers: [SecretCryptoService, TokenHashService],
  exports: [SecretCryptoService, TokenHashService],
})
export class SecurityModule {}
