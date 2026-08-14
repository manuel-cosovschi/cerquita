import { Module } from '@nestjs/common';
import { StoresService } from './stores.service';
import { ProductsService } from './products.service';
import { ProductsController, StoresController } from './stores.controller';

@Module({
  controllers: [StoresController, ProductsController],
  providers: [StoresService, ProductsService],
  exports: [StoresService, ProductsService],
})
export class StoresModule {}
