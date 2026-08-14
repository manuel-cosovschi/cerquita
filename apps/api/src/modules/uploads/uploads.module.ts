import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';

/**
 * The storage provider itself comes from `ProvidersModule`, which is global, so
 * this module only contributes the route.
 */
@Module({
  controllers: [UploadsController],
})
export class UploadsModule {}
