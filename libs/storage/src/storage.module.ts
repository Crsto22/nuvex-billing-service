import { Global, Module } from '@nestjs/common';
import { ArtifactIntegrityService } from './artifact-integrity.service';
import { PrivateObjectStorageService } from './private-object-storage.service';

@Global()
@Module({
  providers: [ArtifactIntegrityService, PrivateObjectStorageService],
  exports: [ArtifactIntegrityService, PrivateObjectStorageService],
})
export class StorageModule {}
